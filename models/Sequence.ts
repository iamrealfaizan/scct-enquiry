import mongoose, { Schema, type Model } from "mongoose";

/**
 * Sequence — atomic counters.
 *
 * The `_id` IS the counter name, so an upsert is a single atomic operation and
 * two concurrent callers cannot receive the same value:
 *
 *   Sequence.findOneAndUpdate({ _id: key }, { $inc: { value: 1 } },
 *                            { new: true, upsert: true })
 *
 * Two counters use this today:
 *   - `enquiry:<year>`   -> the serial inside enquiryNumber (ENQ-2026-000148)
 *   - `assignmentCursor` -> the round-robin position for owner assignment
 *
 * Never derive either from countDocuments(): two concurrent writes would read
 * the same count and produce the same number.
 *
 * DELIBERATE EXCEPTION to the shared-blocks rule (conventions §5.6): this table
 * carries no lifecycle, audit or timestamp blocks. It is an internal counter,
 * not a domain entity — there is no such thing as an archived counter, and
 * "who last incremented it" is answered by EnquiryEvent, not here.
 */
export interface ISequence {
  _id: string;
  value: number;
}

const SequenceSchema = new Schema<ISequence>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

const Sequence =
  (mongoose.models.Sequence as Model<ISequence>) ??
  mongoose.model<ISequence>("Sequence", SequenceSchema);

export default Sequence;
