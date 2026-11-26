"use client";
import { PolicyScreen } from "./PolicyScreen";
import { BuiltinRows } from "./rules/BuiltinRows";
import { LockedRules } from "./rules/LockedRules";
import { RuleList } from "./rules/RuleList";
import { usePolicyDraft } from "./usePolicyDraft";

/** Locked floor, switchable built-ins, then the admin's own rules. */
export function RestrictionsFields() {
  const { data } = usePolicyDraft();
  return (
    <div className="space-y-4">
      <LockedRules floor={data.hardFloor} />
      <BuiltinRows />
      <RuleList />
    </div>
  );
}

export const RestrictionsEditor = () => (
  <PolicyScreen title="Restrictions" showFloor={false}>
    <RestrictionsFields />
  </PolicyScreen>
);
