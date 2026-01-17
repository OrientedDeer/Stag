# Project Guidelines for Claude

## Terminology

- **Checkbox/checkbox**: When the user says "checkbox", use the styled `ToggleInput` component (`src/components/Layout/InputFields/ToggleInput.tsx`), not a native HTML checkbox. This is a slider-style toggle switch.

## Code Style

- **No console.log**: Avoid using `console.log` unless actively debugging. Remove any debug logs before committing.
- **Styled components**: Use existing styled input components from `src/components/Layout/InputFields/` rather than native HTML inputs.

## Key Components

- `ToggleInput` - Styled toggle switch (green slider)
- `DropdownInput` - Custom dropdown using @headlessui/react
- `CurrencyInput` - Currency input with formatting
- `NumberInput` - Numeric input
- `NameInput` - Text input for names

## Message/Alert Styles

Use these consistent styles for informational messages, warnings, and errors:

- **Info (blue):** `bg-blue-900/20 border border-blue-700/50 rounded-lg` with `text-blue-400` for headers
- **Warning (yellow):** `bg-yellow-900/30 border border-yellow-700/50 rounded-lg` with `text-yellow-300` for text
- **Error (red):** `bg-red-900/20 border border-red-800 rounded-lg` with `text-red-400` for headers

## Testing Guidelines

- **Investigate failures before loosening tests**: When a test fails, first investigate whether the failure indicates a real bug in the code. Do NOT immediately loosen test assertions or tolerances to make tests pass. Read the relevant source code to understand the intended behavior before deciding whether the test expectation or the code is wrong.
