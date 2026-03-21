# Design System Document

## 1. Overview & Creative North Star: "The Luminous Canvas"

This design system is built upon the concept of **The Luminous Canvas**. It rejects the rigid, boxed-in layouts of traditional web design in favor of an ethereal, layered environment where content floats within a pressurized, frosted atmosphere. 

To achieve a "High-End Editorial" feel, we move beyond simple glassmorphism. We utilize **intentional asymmetry**—placing large-scale display typography against expansive negative space—and **overlapping depth**, where components aren't just placed next to each other, but exist on different Z-axis planes. The goal is to make the interface feel like a high-end physical installation: light, airy, and hyper-premium.

---

### 2. Colors & Surface Philosophy

The palette is intentionally monochromatic to allow the "Glass & Gradient" effects to provide the visual soul.

*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Definition must be achieved through background shifts (e.g., a `surface-container-low` card resting on a `surface` background) or soft tonal transitions.
*   **Surface Hierarchy & Nesting:** Treat the UI as stacked sheets of fine, frosted glass. 
    *   **Base:** `surface` (#f9f9fb)
    *   **Level 1 (Subtle Inset):** `surface-container-low` (#f2f4f6)
    *   **Level 2 (Floating/Cards):** `surface-container-lowest` (#ffffff)
*   **Glassmorphism & Texture:** For floating navigation or modal elements, use `surface-container-lowest` at **60-80% opacity** with a `backdrop-blur` of 20px to 40px. This allows the background gradient to bleed through, creating a living, reactive interface.
*   **The Signature CTA:** Use a subtle gradient for primary actions, transitioning from `primary` (#5e5e5e) to `primary-dim` (#525252). This provides a "metallic" or "satin" finish that flat grey cannot achieve.

---

### 3. Typography: Editorial Authority

We use 'Inter' (as a high-fidelity alternative to SF Pro) to create a clean, Swiss-inspired typographic hierarchy.

*   **Display (lg/md):** Use for "Hero" moments. These should be set with tight letter-spacing (-0.02em) to feel authoritative and custom.
*   **Headline (lg/md):** These are the anchors of your layout. Pair a `headline-lg` with significant vertical white space (Scale `16` or `20`) to create an editorial "breathing room."
*   **Body (lg/md):** Reserved for high-readability. Use `on-surface-variant` (#596065) for secondary body text to reduce visual "noise" against the white glass surfaces.
*   **Labels:** Use `label-md` in all-caps with increased letter-spacing (+0.05em) for category tags or small metadata to contrast against the fluid shapes of the UI.

---

### 4. Elevation & Depth: The Layering Principle

Shadows and borders are secondary to **Tonal Layering**.

*   **Ambient Shadows:** When a component must "float" (e.g., a primary modal), use an extra-diffused shadow: `box-shadow: 0 20px 40px rgba(45, 51, 56, 0.06)`. The color is a tinted version of `on-surface`, making it feel like ambient occlusion rather than a "drop shadow."
*   **The "Ghost Border" Fallback:** If accessibility requires a container edge, use the `outline-variant` token at **15% opacity**. This creates a "specular highlight" on the edge of the glass rather than a hard line.
*   **Roundedness:** Adhere strictly to the **xl (3rem/48px)** for main containers and **lg (2rem/32px)** for cards. This extreme roundness is the hallmark of the "airy" aesthetic.

---

### 5. Components

#### Buttons
*   **Primary:** `surface-container-lowest` with a high-translucency blur or a solid `primary` (#5e5e5e) with white text. Shape: `full` (pill).
*   **Secondary:** Ghost-style. No background, `outline-variant` at 20% for the border.

#### Input Fields
*   Forgo the "box" look. Use `surface-container-low` with a `xl` corner radius. The label should float above in `label-md`. Focus state: Transition background to `surface-container-lowest` and add a subtle 2px "specular" glow using `surface-tint`.

#### Cards & Lists
*   **No Dividers:** Separate list items using the Spacing Scale `4` (1.4rem). 
*   **Interactive Cards:** Use `surface-container-lowest` at 70% opacity. On hover, increase opacity to 100% and scale slightly (1.02x) to simulate the card moving closer to the user.

#### The "Floating Dock" (Custom Component)
*   A bottom-anchored navigation bar using the `xl` roundedness scale, `surface-container-lowest` at 50% opacity, and a heavy backdrop blur. This is the centerpiece of the glassmorphism effect.

---

### 6. Do's and Don'ts

#### Do:
*   **Do** use asymmetrical margins. A layout that is slightly "off-center" feels designed, whereas perfectly centered layouts can feel like templates.
*   **Do** lean into the "Airy" aspect. If you think there is enough white space, add 20% more.
*   **Do** ensure background gradients have enough contrast to make the white "frosted" elements pop.

#### Don't:
*   **Don't** use 100% black (#000000). Use `inverse-surface` (#0c0e10) for deep tones to keep the palette soft.
*   **Don't** use "Card-in-Card" layouts with borders. Use shifts in the `surface-container` tokens to indicate nesting.
*   **Don't** use standard "Drop Shadows." If the shadow is tight and dark, it breaks the illusion of light passing through glass.