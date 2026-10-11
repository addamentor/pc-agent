import { z } from 'zod'
import { getSettings, saveSettings } from './settings'
import { listProjects, saveProject } from './store'

/**
 * About-me export/import. The app ships with no personal data; users keep their
 * profile and project notes in a small JSON file and import it on a new install.
 */

const AboutMeFile = z.object({
  app: z.literal('pc-agent'),
  kind: z.literal('about-me'),
  version: z.literal(1),
  profile: z.string().max(4000),
  projects: z
    .array(z.object({ name: z.string().min(1).max(100), notes: z.string().max(4000), active: z.boolean().optional() }))
    .max(200)
})

export function exportAboutMe(): string {
  const data = {
    app: 'pc-agent',
    kind: 'about-me',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: getSettings().profile,
    projects: listProjects().map((p) => ({ name: p.name, notes: p.notes, active: !!p.active }))
  }
  return JSON.stringify(data, null, 2)
}

/** Replaces the profile; adds projects, or updates the notes of ones with the same name. */
export function importAboutMe(json: string): { profile: boolean; added: number; updated: number } {
  const data = AboutMeFile.parse(JSON.parse(json))
  saveSettings({ profile: data.profile })
  const existing = new Map(listProjects().map((p) => [p.name.trim().toLowerCase(), p]))
  let added = 0
  let updated = 0
  for (const p of data.projects) {
    const cur = existing.get(p.name.trim().toLowerCase())
    if (cur) {
      saveProject({ id: cur.id, name: cur.name, notes: p.notes, active: p.active === false ? 0 : 1 })
      updated++
    } else {
      saveProject({ name: p.name.trim(), notes: p.notes, active: p.active === false ? 0 : 1 })
      added++
    }
  }
  return { profile: true, added, updated }
}
