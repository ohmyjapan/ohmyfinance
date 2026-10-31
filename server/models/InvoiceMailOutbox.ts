// server/models/InvoiceMailOutbox.ts — the exact MIME bytes of one invoice delivery while it is sending (plan omf-invoice-tnumber-20261030
// C1), so every resend, also one after a restart, carries the same bytes. Deleted when the delivery ends. Not in the backup list.
import mongoose, { Schema, Document } from 'mongoose'

export interface IInvoiceMailOutbox extends Document<string> {
  _id: string
  organizationId: mongoose.Types.ObjectId
  invoiceId: mongoose.Types.ObjectId
  mime: Buffer
  createdAt: Date
}

const InvoiceMailOutboxSchema = new Schema<IInvoiceMailOutbox>({
  _id: { type: String, required: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
  mime: { type: Buffer, required: true }
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'invoicemailoutbox' })

export default mongoose.models.InvoiceMailOutbox as mongoose.Model<IInvoiceMailOutbox> | undefined || mongoose.model<IInvoiceMailOutbox>('InvoiceMailOutbox', InvoiceMailOutboxSchema)
