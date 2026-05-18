// Regional insurance incentive resolver. Looks at a quote's state and
// recommended-tier shape, returns the applicable incentives so we can
// surface them on the contractor view, in the agent's system prompt,
// and on the customer-facing PDF.
//
// Data lives in pricing.json#regional_incentives. Each entry has
// per-audience copy ("description_for_contractor" vs "description_for_customer")
// + a savings_math_template + an action_step.

import { loadPricing } from "./pricing";

export type Incentive = {
  id: string;
  label: string;
  headline: string;
  description_for_contractor: string;
  description_for_customer: string;
  savings_math_template: string;
  action_step: string;
};

type IncentiveDef = Incentive & {
  applies_when: {
    states?: string[];
    tiers?: string[];
  };
};

export function resolveIncentives(opts: {
  state_code: string;
  tier_key: "good" | "better" | "best";
}): Incentive[] {
  const pricing = loadPricing() as unknown as { regional_incentives?: IncentiveDef[] };
  const all = pricing.regional_incentives ?? [];
  const state = opts.state_code.toUpperCase();
  return all
    .filter((inc) => {
      const stateOk = !inc.applies_when.states || inc.applies_when.states.includes(state);
      const tierOk = !inc.applies_when.tiers || inc.applies_when.tiers.includes(opts.tier_key);
      return stateOk && tierOk;
    })
    .map(({ applies_when: _aw, ...rest }) => rest);
}
