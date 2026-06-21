**APEX HEALTH DATA POLICY**

*Last Updated: June 22, 2026*

This Health Data Policy supplements the APEX Privacy Policy and explains, specifically, how APEX collects, uses, and protects health and wellness-related data — the category of information sometimes called “consumer health data” under applicable law. If anything here conflicts with the general Privacy Policy, this Policy controls for health-related data specifically.

# 1. What We Mean by Health Data

In the context of APEX, health data includes:

- Recovery and readiness data: manual recovery check-ins, sleep duration, mood/stress check-ins, and (where connected) recovery metrics derived from wearable screenshots (e.g. HRV, resting heart rate, sleep stages).

- Body composition data: weight, body fat percentage, lean mass, and circumference measurements (waist, hip, arms, thigh), including any DEXA or InBody results you choose to upload.

- Nutrition data: meal photos and the resulting AI-estimated food items, portions, and macros, plus hydration logs.

- Training data: session logs, sets, reps, RIR (reps in reserve), and training load.

- Physique/progress photos, where that feature is enabled.

- Your APEX Shield readiness score and its component pillar scores, which are derived from the data above.

# 2. Why We Collect This Data

We collect this data because it is the direct input to APEX’s core functionality:

- Your APEX Shield score is calculated from your recovery, sleep, nutrition, training load, and mood data — this is the readiness number the entire product is built around.

- APEX Intelligence (our adaptive coaching layer) uses your accumulated history of this data, over time, to identify patterns and generate more relevant coaching guidance the longer you use APEX.

- Body composition entries let you track physical change over time and feed the same Shield/Intelligence reasoning above.

We do not collect health data for advertising purposes, and we do not use it to build advertising profiles.

# 3. How This Data Is Stored

Each meal log, recovery check-in, and body measurement entry is stored as a dated, individual record — not overwritten by your next entry. This is what allows APEX to show trends over time (e.g. a weekly view of your macros, or a body measurement history) and is the basis for APEX Intelligence’s pattern-based coaching (for example, noticing that protein intake has trended under target across several days).

This data is stored in our backend infrastructure (Supabase) with access controls limiting who can view it. We do not currently offer end-to-end encryption for this data category; standard encryption in transit and at rest is applied.

# 4. AI Processing of Health Data

Some of your health data is processed by AI to generate APEX’s core features:

- Meal photos are sent to Anthropic’s Claude API to identify food items, estimate portions in grams, and calculate macros.

- Your Shield score, training history, and adherence data are used as context for APEX Intelligence’s weekly review and coaching responses.

- Wearable screenshots (where applicable) are processed by Claude’s vision capability to extract recovery and sleep metrics.

This processing is necessary to provide the Services you’ve requested. We do not use your health data for any purpose other than generating the specific feature you’re using (e.g. your meal photo is used to estimate that meal’s macros — not repurposed for an unrelated use).

# 5. Redo Program and Your Health Data

If you use the “Redo Program” feature in Settings to change your training goal, training days, or equipment access, this does not delete, alter, or reset any of your historical health data — past meals, recovery check-ins, and body measurements remain exactly as recorded. Only your active training plan changes going forward. We treat your historical data as a continuous record, since a goal change is itself useful context for future coaching, not a reason to discard prior history.

# 6. Your Choices

**Editing entries. **You can review and adjust AI-estimated meal items (e.g. correcting a portion size) directly within the app before or after they are saved.

**Deleting health data. **You can request deletion of your account and all associated health data by contacting us at the email below. We may retain de-identified, aggregated data that no longer identifies you for product improvement purposes.

**Disconnecting a wearable. **If you have connected a wearable data source, you can stop sharing that data with APEX at any time; this does not delete data already collected, but stops new data from that source going forward.

# 7. Not a Medical Device

APEX Shield, APEX Intelligence, and all associated scores, estimates, and recommendations are informational and educational tools, not a medical device and not medical advice. They are not intended to diagnose, treat, cure, or prevent any disease or medical condition, and should not be used as a substitute for professional medical judgment. If you have concerns about your health, please consult a qualified healthcare professional.

# 8. Contact Us

If you have questions about how APEX handles your health data, please contact us at: privacy@apexcoach.app (placeholder — update with APEX’s actual support/legal contact address before public launch).

*This document is scoped to the health data categories APEX actually collects today. It should be reviewed by qualified legal counsel before public launch, and updated promptly whenever a new health data category is introduced (e.g. wearable OAuth, video-based form analysis, DEXA integration).*

	APEX — Health Data Policy	Page
