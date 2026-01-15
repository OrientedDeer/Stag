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
