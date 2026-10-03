// A role's optional annual budget, next to the client it is for. Used to leave
// people above it out of "From your database"; it is never shown to a
// candidate.
export function BudgetFields({ budgetMin, budgetMax, budgetCurrency }: { budgetMin?: number | null; budgetMax?: number | null; budgetCurrency?: string | null }) {
  return (
    <fieldset className="sm:col-span-2 min-w-0">
      <legend className="field-label">Budget a year (optional)</legend>
      <div className="role-budget">
        <div>
          <label htmlFor="budgetMin" className="sr-only">Budget from</label>
          <input id="budgetMin" name="budgetMin" inputMode="numeric" defaultValue={budgetMin ?? ""} placeholder="From, e.g. 80k" className="field-input tabular" />
        </div>
        <div>
          <label htmlFor="budgetMax" className="sr-only">Budget up to</label>
          <input id="budgetMax" name="budgetMax" inputMode="numeric" defaultValue={budgetMax ?? ""} placeholder="Up to, e.g. 95k" className="field-input tabular" />
        </div>
        <div>
          <label htmlFor="budgetCurrency" className="sr-only">Budget currency</label>
          <input id="budgetCurrency" name="budgetCurrency" maxLength={3} defaultValue={budgetCurrency ?? "GBP"} className="field-input uppercase" />
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-soft">Used to leave out people whose confirmed salary is above it when matching from your database.</p>
    </fieldset>
  );
}
