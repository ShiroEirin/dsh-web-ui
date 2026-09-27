/**
 * Sidebar footer action trigger shape family (#1035): the update trigger sits
 * in the shared sidebar.footer.action seat beside the settings trigger and the
 * dsh-remote-web-ui trigger, so its shapes must belong to the same rounding
 * family — the rail circle (50%) and the wide full-row pill (999px). A
 * regression to a small fixed radius on the wide variant reintroduces the
 * circle-vs-rectangle mismatch every skin inherits.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/update.module.css', import.meta.url), 'utf8')

/** Extract one rule block body by its full selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+$\{\}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css)
  if (match === null) throw new Error(selector + ' rule not found in update.module.css')
  return match[1] ?? ''
}

describe('sidebar footer trigger shape family', () => {
  it('operator: the rail trigger stays a 36px circle', () => {
    // Given the update trigger's base rule
    const base = ruleBody('.trigger')
    // When the sidebar is in the collapsed rail
    // Then the control keeps the shared circle geometry
    expect(base).toContain('border-radius: 50%')
    expect(base).toContain('width: 36px')
  })

  it('operator: the wide trigger is a pill, not a fixed-radius rectangle', () => {
    // Given the wide-mode variant of the same trigger
    const wide = ruleBody(".trigger[data-wide='wide']")
    // When the sidebar renders wide content
    // Then maximal rounding keeps it in the seat's shape family
    expect(wide).toContain('border-radius: 999px')
    expect(/border-radius:\s*8px/.test(wide)).toBe(false)
  })
})
