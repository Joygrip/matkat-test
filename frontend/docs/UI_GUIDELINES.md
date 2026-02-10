# UI Design Guidelines - Ferrosan Medical Devices

## Brand Colors

### Primary Brand
- **Ferrosan Blue (Primary):** `#1a1a2e` (dark blue from logo background)
- **Ferrosan Blue (Secondary):** `#16213e` (lighter variant)
- **Ferrosan Blue (Accent):** `#0f3460` (lightest variant)

### Semantic Colors
- **Success:** `#107c10` (green)
- **Warning:** `#ffb900` (amber)
- **Error:** `#d13438` (red)
- **Info:** `#0f6cbd` (blue)

### Neutral Colors
- **Background:** `#f8fafc` (very light neutral)
- **Surface:** `#ffffff` (white)
- **Border:** `#e0e0e0` (light gray)
- **Text Primary:** `#242424` (dark gray)
- **Text Secondary:** `#616161` (medium gray)

## Typography

### Font Family
- Primary: `'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif`
- Monospace: `'Consolas', 'Courier New', monospace`

### Font Sizes (Fluent UI tokens)
- **Headline 1:** `fontSizeBase700` (28px) - Page titles
- **Headline 2:** `fontSizeBase600` (24px) - Section titles
- **Headline 3:** `fontSizeBase500` (20px) - Card titles
- **Body:** `fontSizeBase300` (14px) - Default body text
- **Caption:** `fontSizeBase200` (12px) - Secondary text

### Font Weights
- **Bold:** `fontWeightBold` (700) - Headlines
- **Semibold:** `fontWeightSemibold` (600) - Subheadings
- **Medium:** `fontWeightMedium` (500) - Emphasis
- **Regular:** `fontWeightRegular` (400) - Body text

## Spacing

### Standard Spacing Scale (Fluent UI tokens)
- **XS:** `spacingVerticalXS` / `spacingHorizontalXS` (4px)
- **S:** `spacingVerticalS` / `spacingHorizontalS` (8px)
- **M:** `spacingVerticalM` / `spacingHorizontalM` (12px)
- **L:** `spacingVerticalL` / `spacingHorizontalL` (16px)
- **XL:** `spacingVerticalXL` / `spacingHorizontalXL` (24px)
- **XXL:** `spacingVerticalXXL` / `spacingHorizontalXXL` (32px)

### Component Spacing
- **Card padding:** `spacingHorizontalL` (16px)
- **Page padding:** `spacingHorizontalXL` (24px)
- **Section gap:** `spacingVerticalL` (16px)
- **Grid gap:** `spacingVerticalL` (16px)

## Component Patterns

### PageHeader
```tsx
<PageHeader
  title="Page Title"
  subtitle="Optional subtitle"
  actions={<Button>Action</Button>}
/>
```

### StatusBanner
```tsx
<StatusBanner
  intent="warning" // success | warning | error | info
  title="Status Title"
  message="Status message"
/>
```

### ActionCard / KpiCard
```tsx
<ActionCard
  icon={<Icon />}
  title="Card Title"
  value="123"
  subtitle="Subtitle"
  onClick={handleClick}
/>
```

### EmptyState
```tsx
<EmptyState
  icon={<Icon />}
  title="No items"
  message="Get started by creating your first item"
  action={<Button>Create Item</Button>}
/>
```

### LoadingState
```tsx
<LoadingState message="Loading data..." />
// or
<Skeleton appearance="pulse" />
```

## Layout Standards

### AppShell
- **Sidebar width:** 240px (desktop), collapses to drawer (mobile)
- **Top bar height:** 64px
- **Logo slot:** Top-left of sidebar, 64px height

### Page Layout
- **Max content width:** 1400px (centered)
- **Page padding:** 24px (XL)
- **Card border radius:** `borderRadiusLarge` (8px)
- **Card shadow:** `shadow8` (subtle elevation)

### Tables
- **Row height:** 48px (comfortable)
- **Header:** Sticky, white background
- **Alternating rows:** Subtle background (`colorNeutralBackground2`)
- **Column spacing:** 16px (L)

## Icons

- Use Fluent UI icons consistently
- **Size:** 20px for nav, 24px for buttons, 16px for inline
- **Color:** Inherit from theme or use semantic colors

## Responsive Behavior

### Breakpoints
- **Mobile:** < 768px (nav collapses to drawer)
- **Tablet:** 768px - 1024px
- **Desktop:** > 1024px

### Mobile Adaptations
- Sidebar becomes drawer
- Top bar shows hamburger menu
- Cards stack vertically
- Tables scroll horizontally

## Accessibility

- **Focus rings:** Visible, high contrast
- **Color contrast:** WCAG AA minimum (4.5:1 for text)
- **Keyboard navigation:** Full support
- **Screen readers:** Proper ARIA labels

## Animation

- **Transitions:** 0.2s ease (standard)
- **Hover effects:** Subtle lift (translateY -2px)
- **Loading:** Skeleton or spinner
- **Page transitions:** Fade in (0.3s ease-out)
