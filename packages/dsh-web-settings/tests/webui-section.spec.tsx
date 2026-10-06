/** @vitest-environment jsdom */

/**
 * The Web UI section contract: it renders a static heading and immediately
 * renders every family plugin card through the child slot (no disclosure fold:
 * the nav entry already selects the section).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { WebUIPluginsSection } from '../src/client/WebUIPluginsCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/**
 * English translate stub (same shape the sibling settings-card tests use).
 * Reads from the published dictionary and falls back to the key.
 */
const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('WebUIPluginsSection', () => {
  it('renders the heading alone and the family plugin cards immediately', () => {
    const renderSlot = vi.fn(() => null)
    const props = { t, renderSlot } as ComponentProps<typeof WebUIPluginsSection>
    const { container } = render(<WebUIPluginsSection {...props} />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Web Plugins')
    // The nav cell already names the section, so the lede that restated it is gone.
    expect(container.querySelectorAll('p')).toHaveLength(0)

    expect(renderSlot).toHaveBeenCalledTimes(1)
    expect(renderSlot).toHaveBeenCalledWith('web-ui.plugin.item', {})
  })
})
