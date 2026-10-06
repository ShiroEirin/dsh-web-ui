/**
 * The family tool-surface conventions: the shared section-order band and the
 * provider that renders guidance only while the tools it names are reachable.
 *
 * The behavior under test is the native convention copied from
 * `@deepseek-ai/dsh-tool-subagent`: guidance follows tool visibility.
 */
import { describe, expect, it } from 'vitest'
import { EXTENSION_TOOL_SECTION_ORDER, PLUGIN_TOOL_SECTION_ORDERS, visibleToolText } from '../src/tool-surface.ts'

/** A registry stub whose visibility the test controls by name. */
function registryWith(visible: readonly string[]) {
  const seen = new Set(visible)
  return {
    get(name: string) {
      return seen.has(name) ? { name } : undefined
    },
  }
}

describe('plugin tool section orders', () => {
  it('operator sees one distinct section order per shared band and an extension slot after its host', () => {
    // Given the shared band
    const orders = PLUGIN_TOOL_SECTION_ORDERS

    // When each host plugin's slot is read
    // Then every host owns its own order and none of them ties another
    expect(orders.ssh).toBe(150)
    expect(orders['task-board']).toBe(200)
    expect(new Set(Object.values(orders)).size).toBe(2)

    // And an extension's own section sits after the plugin it extends, in a slot
    // no host plugin holds (the extension names itself, never its host)
    expect(EXTENSION_TOOL_SECTION_ORDER).toBe(210)
    expect(Object.values(orders) as number[]).not.toContain(EXTENSION_TOOL_SECTION_ORDER)
  })
})

describe('visible tool guidance', () => {
  it('user with the tools reachable reads the guidance', () => {
    // Given a scope that can see one of the named tools
    const text = visibleToolText(registryWith(['task_board_list']), ['task_board_list', 'task_board_get'], 'GUIDANCE')

    // When it renders for that scope
    // Then the guidance is present
    expect(text({ scope: {} })).toBe('GUIDANCE')
  })

  it('user whose tools were all withheld reads no guidance', () => {
    // Given a scope where a restriction removed every named tool
    const text = visibleToolText(registryWith([]), ['task_board_list', 'task_board_get'], 'GUIDANCE')

    // When it renders
    // Then the guidance is empty, so the model is never told to call an invisible tool
    expect(text({ scope: {} })).toBe('')
  })

  it('operator on a deployment serving no registry keeps the guidance', () => {
    // Given no registry at all
    const text = visibleToolText(undefined, ['ssh_list'], 'GUIDANCE')

    // When it renders
    // Then the guidance survives: a missing registry is not proof the plugin is unusable
    expect(text({})).toBe('GUIDANCE')
  })

  it('operator whose registry refuses the lookup keeps the guidance', () => {
    // Given a registry whose lookup throws
    const throwing = { get() { throw new Error('registry unavailable') } }

    // When it renders
    // Then a transient read failure does not silently drop the announcement
    expect(visibleToolText(throwing, ['ssh_list'], 'GUIDANCE')({})).toBe('GUIDANCE')
  })

  it('user with an empty tool-name list is told nothing', () => {
    // Given a gate that names no tool
    // When it renders for a scope that has tools
    // Then nothing claims the guidance applies
    expect(visibleToolText(registryWith(['ssh_list']), [], 'GUIDANCE')({})).toBe('')
  })
})
