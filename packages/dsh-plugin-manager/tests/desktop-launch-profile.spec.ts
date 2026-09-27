import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopProfileDirFromArgv, isPackagedDesktopArgv, resolveProfile } from '../src/host/profile.ts'

/**
 * The packaged Desktop launcher is the host shape this file exists for: it
 * boots the running profile through `runProfile()` with NO `--profile` flag
 * and NO DSH_PROFILE variable. An earlier resolution threw "cannot determine
 * the boot profile" there and the host half returned before registering its
 * routes.
 *
 * Two launcher facts name the profile there, and this file pins both: the
 * `profileContext` service the current runtime publishes, and the profile
 * directory the launcher passes positionally in argv (Electron strips exec
 * switches, so `--expose-internals` never reaches `process.argv`).
 */
const DESKTOP_ARGV = [
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
  '/Users/someone/.dsh/profiles/desktop',
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime',
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs',
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin',
]

describe('isPackagedDesktopArgv', () => {
  it('operator: recognises the packaged Desktop launcher entry script', () => {
    // Given the Desktop launcher argv and an ordinary CLI argv
    // When each is classified
    // Then only the launcher that names dsh-desktop-host is the packaged app
    expect(isPackagedDesktopArgv(DESKTOP_ARGV)).toBe(true)
    expect(isPackagedDesktopArgv(['node', 'bin.js', '--profile', 'web'])).toBe(false)
  })
})

describe('desktopProfileDirFromArgv', () => {
  it('operator: reads the profile directory the packaged launcher passes positionally', () => {
    // Given the Desktop argv, whose positional profile directory is the
    // launcher fact available even when no profileContext service exists
    // When the directory is read from argv
    // Then it is the launcher profile directory, never a runtime or install path
    expect(desktopProfileDirFromArgv(DESKTOP_ARGV)).toBe('/Users/someone/.dsh/profiles/desktop')
  })

  it('operator: reports no directory for an argv that names no desktop launcher', () => {
    // Given an ordinary CLI argv carrying a profiles path
    // When the directory is read from argv
    // Then nothing is reported, so a CLI host keeps resolving from its own facts
    expect(desktopProfileDirFromArgv(['node', 'bin.js', '/Users/someone/.dsh/profiles/desktop'])).toBeUndefined()
  })
})

describe('resolveProfile on the packaged Desktop launcher', () => {
  const env = { DSH_HOME: '/tmp/dsh-home' } as NodeJS.ProcessEnv

  it('operator: takes the launched profile when neither the flag nor the environment names one', () => {
    // Given the Desktop argv, no DSH_PROFILE, and the profile the Host published
    // When the boot profile resolves
    // Then every fact comes from the published service, not from the argv
    const facts = resolveProfile(DESKTOP_ARGV, env, {
      name: 'desktop',
      dir: '/Users/someone/.dsh/profiles/desktop',
      patchPath: '/Users/someone/.dsh/profiles/desktop/cordis.patch.yml',
    })
    expect(facts).toEqual({
      profileName: 'desktop',
      profileDir: '/Users/someone/.dsh/profiles/desktop',
      patchPath: '/Users/someone/.dsh/profiles/desktop/cordis.patch.yml',
      packageJsonPath: '/Users/someone/.dsh/profiles/desktop/package.json',
      desktop: true,
    })
  })

  it('operator: falls back to the published directory when only that fact is usable', () => {
    // Given the Desktop argv and a published service carrying no name
    // When the boot profile resolves
    // Then the directory names the profile and the patch path is derived from it
    const facts = resolveProfile(DESKTOP_ARGV, env, { dir: '/Users/someone/.dsh/profiles/desktop' })
    expect(facts).toMatchObject({
      profileName: 'desktop',
      profileDir: '/Users/someone/.dsh/profiles/desktop',
      patchPath: '/Users/someone/.dsh/profiles/desktop/cordis.patch.yml',
      desktop: true,
    })
  })

  it('operator: keeps the explicit flag and the launched profile above a stale environment value', () => {
    // Given a launched profile beside an explicit flag, and separately a
    // globally exported DSH_PROFILE that names a different profile (the
    // Desktop workaround shape)
    // When each launcher fact is present at once
    // Then the explicit flag wins, and the running profile the Host published
    // outranks the environment instead of mounting into a profile the host
    // never reads
    const launched = { name: 'desktop', dir: '/Users/someone/.dsh/profiles/desktop' }
    expect(resolveProfile([...DESKTOP_ARGV, '--profile', 'qa'], env, launched).profileName).toBe('qa')
    expect(resolveProfile(DESKTOP_ARGV, { ...env, DSH_PROFILE: 'headless' }, launched).profileName).toBe('desktop')
  })

  it('operator: uses the exported environment value when the host publishes no profile', () => {
    // Given DSH_PROFILE on a host that publishes no launched profile
    // When the boot profile resolves
    // Then the environment names it, as it did before
    const facts = resolveProfile(['node', 'bin.js'], { ...env, DSH_PROFILE: 'headless' })
    expect(facts.profileName).toBe('headless')
    expect(facts.desktop).toBe(false)
  })

  it('operator: reports the desktop channel probe for the exported desktop workaround too', () => {
    // Given the Desktop launcher with DSH_PROFILE exported globally by a workaround
    // When the boot profile resolves
    // Then the run still counts as desktop so /mode defers to the browser probe
    const facts = resolveProfile(DESKTOP_ARGV, { ...env, DSH_PROFILE: 'desktop' })
    expect(facts).toMatchObject({ profileName: 'desktop', desktop: true })
  })

  it('operator: still refuses to guess when neither the launcher nor the host names a profile', () => {
    // Given an ordinary argv, no environment override, and no published service
    // When the boot profile resolves
    // Then resolution fails loud instead of picking a profile
    expect(() => resolveProfile(['node', 'bin.js'], env)).toThrow(/cannot determine the boot profile/)
  })

  it('operator: rejects a traversal name published by the host service', () => {
    // Given a published profile name that could escape profiles/
    // When the boot profile resolves
    // Then the traversal is rejected before any file is touched
    expect(() => resolveProfile(DESKTOP_ARGV, env, { name: '../../etc' })).toThrow(/invalid profile name/)
  })

  it('operator: uses the published name with the platform profile layout when no directory is published', () => {
    // Given a published name-only service on a non-desktop host
    // When the boot profile resolves
    // Then the directory is rebuilt under DSH_HOME/profiles
    const facts = resolveProfile(['node', 'bin.js'], env, { name: 'headless' })
    expect(facts).toMatchObject({ profileName: 'headless', profileDir: join('/tmp/dsh-home', 'profiles', 'headless') })
  })

  it('operator: takes the published profile over a disagreeing exported variable on any host', () => {
    // Given a non-desktop argv, a published profile, and DSH_PROFILE naming a
    // different profile
    // When the boot profile resolves
    // Then the running profile the Host published wins, because following the
    // variable would mount the gateway into a profile this host never reads
    const facts = resolveProfile(['node', 'bin.js'], { ...env, DSH_PROFILE: 'other' }, {
      name: 'desktop',
      dir: '/Users/someone/.dsh/profiles/desktop',
    })
    expect(facts).toMatchObject({ profileName: 'desktop', profileDir: '/Users/someone/.dsh/profiles/desktop' })
  })

  it('operator: marks desktop from the launcher fact, not from the profile name', () => {
    // Given a profile merely NAMED "desktop" reported to a plain CLI argv
    // When the boot profile resolves
    // Then the run is not treated as the packaged desktop host
    const facts = resolveProfile(['node', 'bin.js'], env, { name: 'desktop' })
    expect(facts.desktop).toBe(false)
  })

  it('operator: rejects a published directory that is not a safe absolute path', () => {
    // Given a published service whose directory is relative or escapes upward
    // When the boot profile resolves
    // Then the directory is rejected before it roots any lookup or write
    expect(() => resolveProfile(DESKTOP_ARGV, env, { name: 'desktop', dir: 'profiles/desktop' }))
      .toThrow(/not a safe absolute path/)
    expect(() => resolveProfile(DESKTOP_ARGV, env, { name: 'desktop', dir: '/Users/someone/.dsh/profiles/../../etc' }))
      .toThrow(/not a safe absolute path/)
  })

  it('operator: accepts only the profile\'s own patch file from the published service', () => {
    // Given a published patch path that is not <dir>/cordis.patch.yml
    // When the boot profile resolves
    // Then it is rejected: that path is a write target, and the profile's own
    // patch file is derived from the directory instead
    expect(() => resolveProfile(DESKTOP_ARGV, env, {
      name: 'desktop',
      dir: '/Users/someone/.dsh/profiles/desktop',
      patchPath: '/etc/passwd',
    })).toThrow(/not the launched profile's own patch file/)
    const facts = resolveProfile(DESKTOP_ARGV, env, {
      name: 'desktop',
      dir: '/Users/someone/.dsh/profiles/desktop',
      patchPath: '/Users/someone/.dsh/profiles/desktop/cordis.patch.yml',
    })
    expect(facts.patchPath).toBe('/Users/someone/.dsh/profiles/desktop/cordis.patch.yml')
  })

  it('operator: rejects a published name that disagrees with the published directory', () => {
    // Given a service whose name (which drives every CLI --profile spawn)
    // names a different profile than the directory it publishes (which drives
    // the files the gateway reads and writes)
    // When the boot profile resolves
    // Then the mismatch is rejected instead of splitting the two write paths
    expect(() => resolveProfile(DESKTOP_ARGV, env, { name: 'other', dir: '/Users/someone/.dsh/profiles/desktop' }))
      .toThrow(/name and directory disagree/)
  })

  it('operator: rejects a profile name of dot or empty', () => {
    // Given profile names that are not one directory segment under profiles/
    // When the boot profile resolves
    // Then they are rejected: join would normalize "." away and resolve to
    // the profiles directory itself
    expect(() => resolveProfile(['node', 'bin.js', '--profile', '.'], env)).toThrow(/invalid profile name/)
    expect(() => resolveProfile(['node', 'bin.js', '--profile', ' '], env)).toThrow(/invalid profile name/)
  })
})

describe('resolveProfile keeps CLI and web host behaviour', () => {
  const env = { DSH_HOME: '/tmp/dsh-home' } as NodeJS.ProcessEnv

  it('operator: resolves the web subcommand profile on a plain CLI launch', () => {
    // Given an ordinary `dsh web` launch with no environment override and no
    // published service
    // When the boot profile resolves
    // Then the web alias decides, exactly as before
    const facts = resolveProfile(['node', 'bin.js', 'web'], env)
    expect(facts).toMatchObject({ profileName: 'web', desktop: false })
  })

  it('operator: keeps an explicit flag above every other launcher fact', () => {
    // Given an explicit --profile beside an exported variable and a published service
    // When the boot profile resolves
    // Then the operator flag wins
    const facts = resolveProfile(['node', 'bin.js', '--profile', 'qa'], { ...env, DSH_PROFILE: 'headless' }, {
      name: 'desktop',
      dir: '/Users/someone/.dsh/profiles/desktop',
    })
    expect(facts.profileName).toBe('qa')
  })

  it('operator: lets DSH_PROFILE name the profile when the host publishes nothing', () => {
    // Given a CLI launch with NO published service, as on a runtime that
    // provides no profileContext
    // When DSH_PROFILE is exported
    // Then it names the profile, so the variable keeps its fallback role
    const facts = resolveProfile(['node', 'bin.js'], { ...env, DSH_PROFILE: 'headless' })
    expect(facts).toMatchObject({ profileName: 'headless', desktop: false })
  })

  it('operator: refuses to let DSH_PROFILE redirect a host that published its own profile', () => {
    // Given a running host that published the profile it actually booted
    // (runProfile provides profileContext on CLI hosts too) while DSH_PROFILE
    // names a different profile - the value the runtime itself DERIVES from
    // that same service for shell children
    // When the boot profile resolves
    // Then the launched profile wins: following the variable would mount the
    // gateway, and write its rows, into a profile this host never reads
    const facts = resolveProfile(['node', 'bin.js', 'web'], { ...env, DSH_PROFILE: 'other' }, {
      name: 'web',
      dir: '/Users/someone/.dsh/profiles/web',
    })
    expect(facts).toMatchObject({ profileName: 'web', profileDir: '/Users/someone/.dsh/profiles/web' })
  })
})

describe('resolveProfile desktop selection fallback', () => {
  it('operator: resolves the packaged desktop profile from its persisted selection', () => {
    // Given a packaged Desktop app that persisted "desktop" as its active profile
    // When the boot profile resolves from that selection alone
    // Then the persisted profile is the resolved one and counts as desktop
    const appData = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
    try {
      const stateDir = join(appData, 'DSH Desktop', 'profile-selection')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ active: 'desktop' }), 'utf8')
      const facts = resolveProfile(['DSH Desktop.exe'], { DSH_HOME: '/tmp/dsh-home', APPDATA: appData } as NodeJS.ProcessEnv)
      expect(facts.profileName).toBe('desktop')
      expect(facts.desktop).toBe(true)
      rmSync(appData, { recursive: true, force: true })
    } catch (error) {
      rmSync(appData, { recursive: true, force: true })
      throw error
    }
  })
})