import { adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { rupees, send, team, who, type Member } from "@/lib/notify-server";

export const runtime = "nodejs";

/**
 * Alert strategy (who is told about what). Called by the app right after an
 * event; the server decides the recipients from roles and permissions, so a
 * person is only alerted about records they are allowed to see.
 *
 *  Event                      Recipients
 *  task.assigned              the assignee
 *  task.done                  the project manager
 *  invoice.issued             invoice viewers who can see money (Accounts, Auditor for GST) + project manager
 *  payment.received           invoice viewers who can see money + project managers of the invoices' projects
 *  bill.recorded              purchase viewers who can see money (Accounts, Auditor for GST bills)
 *  expense.recorded           cash-flow viewers who can see money (Accounts, Auditor for GST)
 *  grn.received               whoever raised the PO + purchase editors who can see money (to record the bill)
 *  approval.requested         the approver role (Admins when the rule says Admin)
 *  approval.decided           the requester
 *  claim.paid                 the claimant
 *  handover.sent              the receiver (to confirm the cash)
 *  record.saved  requirements new requirement → sales roles (requirement / quotation viewers)
 *                quotations   accepted → people who can create projects
 *                projects     project manager assigned → that manager
 *                meetings     new action items → their owners
 *
 * Non-GST records only reach roles with non-GST permission; money events only
 * reach roles with "Can see money". Nobody is alerted about their own action.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { event, col, id, sub } = (await req.json()) as { event: string; col?: string; id: string; sub?: string };
    const db = adminDb();
    const get = async (c: string, i: string) => {
      const s = await db.collection(c).doc(i).get();
      return s.exists ? ({ id: s.id, ...s.data() } as Record<string, any>) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const people: Member[] = await team();
    const by = me.user.name as string;
    let sent = 0;

    switch (event) {
      case "task.assigned":
      case "task.done": {
        const p = await get("projects", id);
        const t = sub ? (await db.collection("projects").doc(id).collection("tasks").doc(sub).get()).data() : null;
        if (!p || !t) throw new HttpError(404, "Task not found");
        if (event === "task.assigned")
          sent = await send([t.assignee], { type: event, title: `New task: ${t.title}`, body: `${p.name}${t.due ? ` · due ${t.due}` : ""} · from ${by}`, link: `/projects/${id}` }, me.uid);
        else sent = await send([p.managerId], { type: event, title: `Task done: ${t.title}`, body: `${p.name} · by ${by}`, link: `/projects/${id}` }, me.uid);
        break;
      }
      case "invoice.issued": {
        const inv = await get("invoices", id);
        if (!inv) throw new HttpError(404, "Invoice not found");
        const pm = inv.projectId ? (await get("projects", inv.projectId))?.managerId : null;
        const pmOk = pm && people.find((x) => x.uid === pm && x.role && (x.role.isAdmin || x.role.money));
        sent = await send([...who(people, { module: "invoices", money: true, billingType: inv.billingType }), pmOk ? pm : null], {
          type: event, title: `Invoice ${inv.number} issued`, body: `${inv.clientName} · ${rupees(inv.total)} · by ${by}`, link: `/invoices/${id}`,
        }, me.uid);
        break;
      }
      case "payment.received": {
        const p = await get("payments", id);
        if (!p) throw new HttpError(404, "Payment not found");
        const pms: string[] = [];
        for (const a of (p.allocations ?? []) as { projectId?: string }[]) if (a.projectId) { const pr = await get("projects", a.projectId); if (pr?.managerId) pms.push(pr.managerId); }
        const moneyPms = pms.filter((u) => people.find((x) => x.uid === u && (x.role.isAdmin || x.role.money)));
        sent = await send([...who(people, { module: "invoices", money: true, billingType: p.billingType }), ...moneyPms], {
          type: event, title: `Payment received ${rupees(p.amount)}`, body: `${p.clientName}${Number(p.tds) ? ` · TDS ${rupees(p.tds)}` : ""} · ${p.mode}`, link: `/payments`,
        }, me.uid);
        break;
      }
      case "bill.recorded": {
        const b = await get("purchaseBills", id);
        if (!b) throw new HttpError(404, "Bill not found");
        sent = await send(who(people, { module: "purchases", money: true, billingType: b.billingType }), {
          type: event, title: `New vendor bill ${b.billNo}`, body: `${b.vendorName} · ${rupees(b.total)} · due ${b.dueDate}`, link: b.poId ? `/purchases/${b.poId}` : "/purchases",
        }, me.uid);
        break;
      }
      case "expense.recorded": {
        const e = await get("entries", id);
        if (!e) throw new HttpError(404, "Entry not found");
        sent = await send(who(people, { module: "cashflow", money: true, billingType: e.billingType }), {
          type: event, title: `New bill: ${e.category}`, body: `${rupees(e.amount)} · ${by}${e.notes ? ` · ${e.notes}` : ""}`, link: "/cashflow",
        }, me.uid);
        break;
      }
      case "grn.received": {
        const g = await get("grns", id);
        if (!g) throw new HttpError(404, "Goods receipt not found");
        const po = g.poId ? await get("pos", g.poId) : null;
        sent = await send([po?.createdBy, ...who(people, { module: "purchases", action: "edit", money: true, billingType: po?.billingType })], {
          type: event, title: `Goods received: ${g.poNumber ?? "PO"}`, body: `${g.vendorName ?? ""} · ${g.location} · record the vendor bill`, link: g.poId ? `/purchases/${g.poId}` : "/purchases",
        }, me.uid);
        break;
      }
      case "approval.requested": {
        const a = await get("approvals", id);
        if (!a) throw new HttpError(404, "Approval not found");
        const approvers = people.filter((x) => (a.approverRole === "admin" ? x.role.isAdmin : x.roleId === a.approverRole || x.role.isAdmin)).map((x) => x.uid);
        sent = await send(approvers, { type: event, title: "Approval needed", body: `${a.summary} · from ${a.requestedByName}`, link: a.link || "/approvals" }, me.uid);
        break;
      }
      case "claim.paid": {
        const c = await get("claims", id);
        if (!c) throw new HttpError(404, "Claim not found");
        sent = await send([c.claimant], { type: event, title: `Claim paid ${rupees(c.amount)}`, body: `${c.category} · ${c.description ?? ""}`, link: "/claims" }, me.uid);
        break;
      }
      case "handover.sent": {
        const t = await get("transfers", id);
        if (!t) throw new HttpError(404, "Transfer not found");
        sent = await send([t.toHolder], { type: event, title: `Cash handover ${rupees(t.amount)}`, body: `From ${by} — confirm when you receive it`, link: "/accounts" }, me.uid);
        break;
      }
      case "record.saved": {
        const d = col ? await get(col, id) : null;
        if (!d) throw new HttpError(404, "Record not found");
        const ref = db.collection(col!).doc(id);
        if (col === "requirements" && !d.notifiedNew) {
          await ref.update({ notifiedNew: true });
          sent = await send([...who(people, { module: "requirements" }), ...who(people, { module: "quotations", action: "create" })], {
            type: "requirement.new", title: `New requirement: ${d.title}`, body: `${d.code ?? ""} · ${d.kind ?? ""} · by ${by}`, link: `/requirements/${id}`,
          }, me.uid);
        } else if (col === "quotations" && d.status === "Accepted" && !d.notifiedAccepted) {
          await ref.update({ notifiedAccepted: true });
          sent = await send(who(people, { module: "projects", action: "create", money: true, billingType: d.billingType }), {
            type: "quotation.accepted", title: `Quotation accepted: ${d.title}`, body: `${d.number} · ${rupees(d.value)} — convert it to a project`, link: `/quotations/${id}`,
          }, me.uid);
        } else if (col === "projects" && d.managerId && d.notifiedManager !== d.managerId) {
          await ref.update({ notifiedManager: d.managerId });
          sent = await send([d.managerId], { type: "project.manager", title: `You manage ${d.name}`, body: `${d.code ?? ""} · assigned by ${by}`, link: `/projects/${id}` }, me.uid);
        } else if (col === "meetings") {
          const actions = ((d.actions ?? []) as Record<string, unknown>[]).map((x) => ({ ...x }));
          const fresh = actions.filter((x) => x.owner && !x.notified);
          if (fresh.length) {
            actions.forEach((x) => { if (x.owner) x.notified = true; });
            await ref.update({ actions });
            for (const x of fresh)
              sent += await send([x.owner as string], { type: "action.assigned", title: `Action item: ${x.description}`, body: `${d.title}${x.due ? ` · due ${x.due}` : ""}`, link: `/meetings/${id}` }, me.uid);
          }
        }
        break;
      }
      default:
        throw new HttpError(400, `Unknown event ${event}`);
    }
    return Response.json({ sent });
  } catch (e) {
    return errorResponse(e);
  }
}
