// Compatibility export. Budget policy belongs to the optional Goal module;
// existing imports keep working during the module-boundary migration window.
export {
  TurnTimeBudgetGuard,
  type BudgetGuard,
  type TurnTimeBudgetLimits as BudgetLimits,
  type TurnTimeBudgetSnapshot as BudgetSnapshot,
  type TurnTimeBudgetVerdict as BudgetVerdict,
} from "@/lib/unattended-goal/budget";
