/**
 * Model registry.
 *
 * This file is NOT a convenience re-export — it is load-bearing.
 *
 * Mongoose resolves a `ref` by NAME at populate time, and a name only exists once
 * the model file that declares it has been imported. So a service that imports
 * only `Enquiry` and then calls `.populate("programme")` throws
 * `MissingSchemaError: Schema hasn't been registered for model "Programme"` —
 * intermittently, because whether it works depends on which other file happened
 * to be imported first. In serverless that is worse: it varies per cold start.
 *
 * Importing every model here once guarantees all names are registered before any
 * populate runs.
 *
 * THE RULE: services and route handlers import models from `@/models`, never from
 * an individual model file.
 *
 * This does not violate one-file-one-entity (conventions §5.1): no schema is
 * declared here. Each entity still lives alone in its own file.
 */

export { default as Enquiry, type IEnquiry } from "./Enquiry";
export {
  default as EnquiryDuplicate,
  type IEnquiryDuplicate,
} from "./EnquiryDuplicate";
export {
  default as EnquiryEvent,
  type IEnquiryEvent,
  type EnquiryEventType,
} from "./EnquiryEvent";
export { default as EnquirySource, type IEnquirySource } from "./EnquirySource";
export { default as EnquiryStatus, type IEnquiryStatus } from "./EnquiryStatus";
export { default as FollowUp, type IFollowUp } from "./FollowUp";
export { default as Permission, type IPermission } from "./Permission";
export { default as Programme, type IProgramme } from "./Programme";
export { default as Role, type IRole } from "./Role";
export { default as Sequence, type ISequence } from "./Sequence";
export { default as StaffProfile, type IStaffProfile } from "./StaffProfile";
export { default as User, type IUser, type IUserMethods } from "./User";
