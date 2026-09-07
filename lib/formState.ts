// Server actions used to return nothing, so a rejected save looked exactly
// like a successful one: the page just sat there. Actions that can refuse a
// submission now return one of these instead, and ActionForm renders it.

export type FormState = {
  error?: string;
  notice?: string;
};

export const EMPTY_FORM_STATE: FormState = {};
