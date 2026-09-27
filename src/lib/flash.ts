export const NOTICES = {
  draft_saved: "Draft saved. A different admin approves the issuance.",
  batch_approved: "Issuance approved. The serial range is on this page.",
  batch_rejected: "Draft rejected. Nothing was written to the ledger.",
  project_created: "Project created.",
  documents_added: "Documents added.",
  holder_created: "Holder account created.",
  transferred: "Transfer posted.",
  cancelled: "Cancellation posted.",
  retired: "Retirement posted. The certificate is ready to download.",
  password_changed: "Password updated.",
  saved: "Saved.",
} as const;

export const ERRORS = {
  draft_failed: "The draft could not be saved.",
  approve_failed: "The batch could not be approved.",
  reject_failed: "The draft could not be rejected.",
  project_failed: "The project could not be created.",
  project_missing: "Project not found.",
  documents_failed: "The documents could not be uploaded.",
  holder_failed: "The holder could not be created.",
  transfer_failed: "The transfer could not be posted.",
  cancel_failed: "The cancellation could not be posted.",
  retire_holder_only: "Only a holder account can retire credits.",
  retire_no_account: "This account has no holding ledger.",
  retire_failed: "The retirement could not be posted.",
  password_failed: "The password could not be changed.",
  password_mismatch: "The new password and confirmation do not match.",
  password_wrong: "The current password is incorrect.",
  password_same: "Choose a different password.",
  form_invalid: "Check the form and try again.",
  text_too_long: "That text is too long.",
  insufficient: "That serial range is not fully held.",
  overlap: "Those serial numbers overlap an existing issuance.",
  not_found: "That record was not found.",
  invalid: "Those details were not accepted.",
  invariant: "The ledger rejected this entry.",
  already_used: "That value is already in use.",
} as const;

export type NoticeCode = keyof typeof NOTICES;
export type ErrorCode = keyof typeof ERRORS;

export function noticeText(code: string | undefined): string | undefined {
  if (!code || !(code in NOTICES)) return undefined;
  return NOTICES[code as NoticeCode];
}

export function errorText(code: string | undefined): string | undefined {
  if (!code || !(code in ERRORS)) return undefined;
  return ERRORS[code as ErrorCode];
}
