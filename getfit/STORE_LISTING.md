# App Store listing copy

Paste into App Store Connect → your app → the version page under **iOS App**.
Character limits are Apple's; the counts here are the real length of the text
below, checked by `npm run listing --workspace @getfit/mobile`.

US English throughout, matching the app's own copy ("Personalized workouts").

---

## Subtitle (limit 30)

```
Body analysis, no photo needed
```

Alternatives, if that reads wrong to you:

```
Train from real measurements
```

```
Measure, analyze, train
```

---

## Description (limit 4,000)

```
GetFit turns a tape measure into a training plan.

Enter your waist, neck, height and weight. GetFit estimates your body composition using the published US Navy circumference formulas and builds a workout program around the result. No photo required.

SEE YOUR ANALYSIS BEFORE YOU PAY
Your first body analysis costs nothing. You see your body-fat estimate, your muscle mass, your waist-to-body ratio and a hologram figure of your current build before any payment is requested.

WHAT YOU GET
• A body-fat estimate from tape measurements, not from a photograph
• A hologram figure drawn from your own numbers, not a stock body
• A training program built for your level, goals, equipment and schedule
• 159 exercises across 11 muscle groups
• Guided workouts with a rest timer, set by set
• Progressive overload that adjusts loads from what you actually lifted
• Weekly reassessment, so progress is measured rather than assumed
• Left and right balance scoring from limb measurements
• Metric or imperial: centimeters and kilograms, or feet, inches and pounds

BUILT AROUND YOU
Tell GetFit your training level, your goal — muscle gain, fat loss, recomposition, strength or general fitness — how many days a week you train, how long you have (15, 30, 45 or 60 minutes) and what equipment you can reach. Twenty-five options, from a full gym to nothing at all. Choose your preferred exercises for each muscle group and your program uses them.

PROGRESS YOU CAN SEE
A new assessment unlocks every 7 days, so the comparison means something. Body fat, weight, muscle mass, waist-to-body ratio and symmetry are tracked over time, alongside strength curves for each exercise, personal records and session volume.

PHOTOS ARE OPTIONAL
You can attach a progress photo to an assessment. It is entirely optional, the app works fully without one, and it is never analyzed — it exists only so you have a genuine before-and-after to look back on. Photos are never shown in Progress or History, never shared with anyone, and never used for advertising or to train any model.

MEMBERSHIP
A GetFit Membership unlocks your training program and weekly analysis.

• Monthly — $4.99 per month
• Yearly — $19.99 per year, which works out at $1.67 a month

There is no free trial. Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically for the same price and period unless auto-renew is turned off at least 24 hours before the end of the current period. You can manage or cancel it in your Apple Account settings.

Privacy Policy: https://elshaab.github.io/github-slideshow/privacy.html
Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

BEFORE YOU START
GetFit is a fitness tool, not a medical device. Body-composition figures are estimates produced by published formulas, not clinical measurements, and nothing in the app is medical advice. Speak to a doctor before beginning a new training program, particularly if you have an injury or a heart condition, or are pregnant.
```

---

## Keywords (limit 100, comma separated, no spaces after commas)

```
body fat,tape measure,workout plan,strength,progressive overload,gym,muscle,recomposition,physique
```

Do not repeat the app name or the subtitle — Apple already indexes both, so
repeating them wastes the budget.

## Promotional text (limit 170, editable without a new build)

```
Your body-fat estimate comes from a tape measure, not a photo. See your full analysis free, then train from a program built around the result.
```

---

## Notes on what is deliberately absent

- **No claim about AI.** The app has none: body composition is computed
  in-process from published formulas, and the privacy policy says so. The
  repository name is a leftover, not a feature.
- **No claim about where data is stored.** The privacy policy and the shipped
  binary currently disagree on that, and a description is a bad place to
  settle it.
- **No "was $40".** The struck-through price in the app claims a price GetFit
  has never charged. Saying it in the listing too would compound it.
- **No ranking or superlative claims** ("best", "#1"), which Apple rejects
  without evidence.
