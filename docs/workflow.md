# Evaluation and objection workflow

## Evaluation lifecycle

```text
Draft
  → Submitted by QC
  → Returned for correction OR Awaiting approval
  → Published to tutor
  → Closed or Reopened
```

### Draft

The evaluator can enter session details, score observable learning behaviors, record compliance results, add evidence, and save incomplete work.

### Submitted

All active criteria must be answered. The evaluator can still correct the review while it remains submitted or is returned.

### Awaiting approval

Admin/QTL validates the review, confirms the evidence and flag logic, then publishes it.

### Published

The tutor can see the review, scores, tutor-visible feedback, and flags. Only published reviews accept tutor objections.

## Flag logic

- A first violation of a compliance criterion creates a Yellow Flag.
- A violation of the same criterion in a later review creates a Red Flag.
- The database derives repetition from historical flag records; evaluators do not manually select Red.
- A removed flag stays in history and can still establish a repeated offense in a later review.
- Flag removal or downgrade requires Admin/QTL approval and an audit reason.

## Objection lifecycle

```text
Tutor submits objection
  → Different QC claims/reviews it
  → Accepted / Partially Accepted / Rejected / Evidence Required
  → If a flag changes: Awaiting QTL approval
  → Decision issued to tutor
  → Closed
```

The original evaluator must not decide an objection against their own review. The database queue excludes unassigned objections from the original evaluator.

## Objection targets

- A specific flag
- A criterion score
- A written comment
- A calculation
- The complete review

## Evidence principles

Every contested point should support:

- A clear reason category
- The tutor's explanation
- A relevant timestamp where possible
- Supporting evidence or attachment where needed
- The requested outcome
- A decision explanation
- Old and new values when a score, comment, or flag changes

## Audit trail

Critical inserts, updates, and deletions on reviews, flags, and objections are copied into `audit_logs`. Workflow records should be closed or superseded rather than deleted during normal operations.
