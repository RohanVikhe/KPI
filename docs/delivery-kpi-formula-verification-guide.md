# Delivery Department KPI - Formula, Excel, and Data Entry Verification Guide

## 1. Purpose
This document explains:
- Every formula used by the Delivery Department KPI template (backend source of truth).
- Every formula written into the Excel template.
- Exactly what each user must fill (input fields only).
- One full sample dataset with expected computed values and final score.

Use this guide to verify calculations with your manager.

## 2. Source of Truth in Code
- Template and formulas: `server/src/db/seedDefaultTemplate.ts`
- Scoring engine: `server/src/utils/score.ts`
- Submission flow (computed values ignored from client and recalculated on server): `server/src/services/submissionService.ts`
- Excel template generation/import logic: `client/src/pages/NewSubmissionPage.tsx`

## 3. End-to-End Calculation Flow
1. User fills only input metrics in Excel/portal.
2. Excel shows computed metrics using formulas in the sheet.
3. On upload/submit, backend ignores submitted computed metrics and recalculates from raw inputs.
4. Backend computes each goal score using goal formula.
5. Backend computes overall score using template formula.
6. Backend stores final score in `KpiSubmission.score`.

## 4. What User Must Fill (Individually)

### 4.1 Summary Sheet
- `Template`: auto label, should match selected template.
- `Period Start (YYYY-MM-DD)`: required.
- `Period End (YYYY-MM-DD)`: required and must be >= period start.
- Goal comments: optional.

### 4.2 Goal Sheets
Rule: Fill only rows where `Required` is `Yes` (input metrics). Rows marked `Auto` are computed.

All input metrics in this template are required.

## 5. Backend Template Formulas

### 5.1 Overall Formula
`overall_score = (billability_utilization + delivery_excellence + quality_process + value_client) / 4`

### 5.2 Goal Formulas
- `billability_utilization = (utilization_rate + billability_rate) / 2`
- `delivery_excellence = (on_time_delivery + scope_change_control + first_time_right + schedule_adherence + escalation_rate + post_delivery_defect_rate) / 6`
- `quality_process = (delivery_error_rework_rate + process_compliance_rate + change_management_adherence + automation_adoption) / 4`
- `value_client = (additional_initiatives_delivered + csat_score) / 2`

### 5.3 Computed Metric Formulas
| Goal | Metric Key | Backend Formula |
|---|---|---|
| Billability & Utilization | `utilization_rate` | `(bu_billable_hours / bu_available_hours) * 100` |
| Billability & Utilization | `billability_rate` | `(bu_billable_hours / bu_total_working_hours) * 100` |
| Delivery Excellence | `on_time_delivery` | `(de_projects_on_time_budget / de_total_projects_delivered) * 100` |
| Delivery Excellence | `scope_change_control` | `(de_approved_scope_changes / de_total_scope_requests) * 100` |
| Delivery Excellence | `first_time_right` | `(de_deliverables_accepted / de_total_deliverables) * 100` |
| Delivery Excellence | `schedule_adherence` | `(de_milestones_on_time / de_total_milestones) * 100` |
| Delivery Excellence | `escalation_rate` | `de_escalation_count` |
| Delivery Excellence | `post_delivery_defect_rate` | `(de_post_delivery_defects / de_total_deliveries) * 100` |
| Quality & Process | `delivery_error_rework_rate` | `(qp_rework_count / qp_total_deliverables) * 100` |
| Quality & Process | `process_compliance_rate` | `(qp_compliant_deliveries / qp_total_deliveries) * 100` |
| Quality & Process | `change_management_adherence` | `(qp_formal_changes / qp_total_changes) * 100` |
| Quality & Process | `automation_adoption` | `(qp_automated_projects / qp_total_projects) * 100` |
| Value Add & Client Satisfaction | `additional_initiatives_delivered` | `vc_additional_initiatives` |
| Value Add & Client Satisfaction | `csat_score` | `(vc_total_score / vc_total_responses)` |

## 6. Exact Excel Formulas (as Generated)

Excel writes formulas into the `Value` column (column `F`) and wraps each formula as `IFERROR(..., "")`.

### 6.1 Sheet: Billability & Utilization
- `F10` (`utilization_rate`): `IFERROR((F7/F8)*100,"")`
- `F11` (`billability_rate`): `IFERROR((F7/F9)*100,"")`

### 6.2 Sheet: Delivery Excellence
- `F18` (`on_time_delivery`): `IFERROR((F7/F8)*100,"")`
- `F19` (`scope_change_control`): `IFERROR((F9/F10)*100,"")`
- `F20` (`first_time_right`): `IFERROR((F11/F12)*100,"")`
- `F21` (`schedule_adherence`): `IFERROR((F13/F14)*100,"")`
- `F22` (`escalation_rate`): `IFERROR(F15,"")`
- `F23` (`post_delivery_defect_rate`): `IFERROR((F16/F17)*100,"")`

### 6.3 Sheet: Quality & Process
- `F15` (`delivery_error_rework_rate`): `IFERROR((F7/F8)*100,"")`
- `F16` (`process_compliance_rate`): `IFERROR((F9/F10)*100,"")`
- `F17` (`change_management_adherence`): `IFERROR((F11/F12)*100,"")`
- `F18` (`automation_adoption`): `IFERROR((F13/F14)*100,"")`

### 6.4 Sheet: Value Add & Client Satisfaction
- `F10` (`additional_initiatives_delivered`): `IFERROR(F7,"")`
- `F11` (`csat_score`): `IFERROR((F8/F9),"")`

Note: Excel does not auto-calculate goal score and overall score in the workbook. Those are finalized on backend submission.

## 7. User Input Fields and Sample Values

### 7.1 Billability & Utilization (User Input)
| Metric Key | Label | Required | Valid Rule | Sample Value |
|---|---|---|---|---|
| `bu_billable_hours` | Billable Hours | Yes | >= 0 | 160 |
| `bu_available_hours` | Available Hours | Yes | >= 1 | 176 |
| `bu_total_working_hours` | Total Working Hours | Yes | >= 1 | 184 |

### 7.2 Delivery Excellence (User Input)
| Metric Key | Label | Required | Valid Rule | Sample Value |
|---|---|---|---|---|
| `de_projects_on_time_budget` | Projects Delivered On Time & Budget | Yes | >= 0 | 18 |
| `de_total_projects_delivered` | Total Projects Delivered | Yes | >= 1 | 20 |
| `de_approved_scope_changes` | Approved Scope Changes | Yes | >= 0 | 16 |
| `de_total_scope_requests` | Total Scope Change Requests | Yes | >= 1 | 20 |
| `de_deliverables_accepted` | Deliverables Accepted Without Rework | Yes | >= 0 | 45 |
| `de_total_deliverables` | Total Deliverables | Yes | >= 1 | 50 |
| `de_milestones_on_time` | Milestones Completed On Time | Yes | >= 0 | 27 |
| `de_total_milestones` | Total Milestones | Yes | >= 1 | 30 |
| `de_escalation_count` | Escalation Count | Yes | >= 0 | 1 |
| `de_post_delivery_defects` | Post Delivery Defects | Yes | >= 0 | 2 |
| `de_total_deliveries` | Total Deliveries | Yes | >= 1 | 40 |

### 7.3 Quality & Process (User Input)
| Metric Key | Label | Required | Valid Rule | Sample Value |
|---|---|---|---|---|
| `qp_rework_count` | Deliverables Requiring Rework | Yes | >= 0 | 2 |
| `qp_total_deliverables` | Total Deliverables (Quality) | Yes | >= 1 | 50 |
| `qp_compliant_deliveries` | Process Compliant Deliveries | Yes | >= 0 | 47 |
| `qp_total_deliveries` | Total Deliveries (Process) | Yes | >= 1 | 50 |
| `qp_formal_changes` | Formally Managed Changes | Yes | >= 0 | 18 |
| `qp_total_changes` | Total Changes | Yes | >= 1 | 20 |
| `qp_automated_projects` | Projects Using Automation | Yes | >= 0 | 6 |
| `qp_total_projects` | Total Projects | Yes | >= 1 | 10 |

### 7.4 Value Add & Client Satisfaction (User Input)
| Metric Key | Label | Required | Valid Rule | Sample Value |
|---|---|---|---|---|
| `vc_additional_initiatives` | Additional Initiatives Completed | Yes | >= 0 | 2 |
| `vc_total_score` | Total Client Ratings Score | Yes | >= 0 | 88 |
| `vc_total_responses` | Total Client Responses | Yes | >= 1 | 20 |

## 8. Worked Sample - Expected Results

### 8.1 Computed Metrics
| Metric Key | Calculation | Result |
|---|---|---|
| `utilization_rate` | (160 / 176) * 100 | 90.91 |
| `billability_rate` | (160 / 184) * 100 | 86.96 |
| `on_time_delivery` | (18 / 20) * 100 | 90.00 |
| `scope_change_control` | (16 / 20) * 100 | 80.00 |
| `first_time_right` | (45 / 50) * 100 | 90.00 |
| `schedule_adherence` | (27 / 30) * 100 | 90.00 |
| `escalation_rate` | 1 | 1.00 |
| `post_delivery_defect_rate` | (2 / 40) * 100 | 5.00 |
| `delivery_error_rework_rate` | (2 / 50) * 100 | 4.00 |
| `process_compliance_rate` | (47 / 50) * 100 | 94.00 |
| `change_management_adherence` | (18 / 20) * 100 | 90.00 |
| `automation_adoption` | (6 / 10) * 100 | 60.00 |
| `additional_initiatives_delivered` | 2 | 2.00 |
| `csat_score` | 88 / 20 | 4.40 |

### 8.2 Goal Scores
| Goal Key | Formula | Result |
|---|---|---|
| `billability_utilization` | (90.91 + 86.96) / 2 | 88.93 |
| `delivery_excellence` | (90 + 80 + 90 + 90 + 1 + 5) / 6 | 59.33 |
| `quality_process` | (4 + 94 + 90 + 60) / 4 | 62.00 |
| `value_client` | (2 + 4.4) / 2 | 3.20 |

### 8.3 Overall Score
`overall_score = (88.93 + 59.33 + 62.00 + 3.20) / 4 = 53.37`

## 9. Targets (for manager review)
- Utilization Rate: target 90-100, acceptable >= 85
- Billability Rate: target 100
- On-Time Delivery: > 90
- Scope Change Control: > 80
- First Time Right: > 90
- Schedule Adherence: > 90
- Escalations: < 2 preferred <= 1
- Post Delivery Defect Rate: < 5
- Delivery Error/Rework Rate: < 5
- Process Compliance: > 95
- Change Management Adherence: > 90
- Automation Adoption: > 60
- Additional Initiatives: > 1
- CSAT: > 4.2/5

## 10. Important Validation Notes
- Backend enforces required fields and min/max checks.
- Computed metric rows are not trusted from upload; backend recomputes from raw inputs.
- Because some goal formulas mix `%` values with count values (`escalation_rate`, `additional_initiatives_delivered`, `csat_score`), final score scale may look lower than expected. This is current implemented behavior.

## 11. Quick Checklist for User Before Submit
- Fill period start and end.
- Fill all required input rows in each goal sheet.
- Do not type in `Auto` rows.
- Ensure denominators are non-zero (template already enforces min = 1 on denominator fields).
- Review computed rows in Excel for sanity.
- Submit.
