export const LIMITS = {
  beneficiary: 200,
  reason: 2000,
  memo: 500,
  rejectionNote: 2000,
  methodology: 200,
  password: 200,
} as const;

export const MAX_DOCUMENT_BYTES = 1_500_000;
export const MAX_DOCUMENTS_PER_REQUEST = 2;
export const MAX_ACTION_BODY = "4mb";
