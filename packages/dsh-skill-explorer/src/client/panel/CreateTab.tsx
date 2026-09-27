/**
 * Create tab: the new-skill form (user or project root).
 *
 * The host's create route needs the workspace the panel is showing, which the
 * list payload carries. The inactive tab unmounts, so a user who opens this
 * tab first has no cwd: the first submit resolves it with one list call and
 * reuses it afterwards.
 */
import { useState, type FormEvent } from 'react'
import { SkillApi } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import css from './panel.module.css'

/** Create-form feedback line. */
type Feedback = { text: string; kind: 'ok' | 'error' }

/** The create tab body. */
export function CreateTab({ api }: { api: SkillApi }): React.JSX.Element {
  const [root, setRoot] = useState<'user' | 'project'>('user')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [content, setContent] = useState('')
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || description.trim() === '' || content.trim() === '') {
      setFeedback({ text: tt('create.empty'), kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const workspace = cwd ?? (await api.list()).cwd
      setCwd(workspace)
      const result = await api.create({
        root,
        name: name.trim(),
        description: description.trim(),
        whenToUse: whenToUse.trim() || undefined,
        content,
        cwd: workspace,
      })
      setFeedback({ text: tt('create.created', { path: result.path }), kind: 'ok' })
      setName('')
      setDescription('')
      setWhenToUse('')
      setContent('')
    } catch (err) {
      setFeedback({ text: tt('create.failed', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.root')}</span>
          <select className={css.select} value={root} onChange={(event) => { setRoot(event.target.value as 'user' | 'project') }}>
            <option value="user">{tt('create.root.user')}</option>
            <option value="project">{tt('create.root.project')}</option>
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.name')}</span>
          <input className={css.input} value={name} placeholder={tt('create.namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.description')}</span>
          <input className={css.input} value={description} onChange={(event) => { setDescription(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.whenToUse')}</span>
          <input className={css.input} value={whenToUse} onChange={(event) => { setWhenToUse(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.content')}</span>
          <textarea className={`${css.input} ${css.textarea}`} value={content} onChange={(event) => { setContent(event.target.value) }} />
        </label>
        <button type="submit" className={css.primaryButton} disabled={busy}>{tt('create.submit')}</button>
        {feedback !== undefined && <p className={css.banner} data-kind={feedback.kind}>{feedback.text}</p>}
        <p className={css.note}>{tt('create.note')}</p>
      </form>
    </div>
  )
}
