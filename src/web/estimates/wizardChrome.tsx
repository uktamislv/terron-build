// Smeta import ustasining "ramkasi": sarlavha, bosqichlar (stepper) va bosqich kartochkasi.
// Taqdimot komponentlari — ImportWizard va ko'rgazma (/__preview) uchun umumiy.
import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Button, choiceClass, cx, PageHeader } from '@/components/ui'
import { t } from '@/i18n'
import { STEPS, type StepKey } from './wizardModel'

const tw = t.estimates.wizard

/**
 * Bosqichlar: raqamli doiralar, tugaganlari ✓, joriy — `aria-current="step"`.
 * O'tilgan bosqichga qaytish mumkin (`maxStep` gacha), "Saqlash" bosqichiga — faqat tugma orqali.
 */
export function WizardStepper({
  step,
  maxStep,
  saving,
  onStep,
  steps = STEPS,
}: {
  step: number
  maxStep: number
  saving: boolean
  onStep: (i: number) => void
  /** Ko'rinadigan bosqichlar (resurs smetasida varaq/ustun/qator bosqichlari yo'q). */
  steps?: readonly StepKey[]
}) {
  return (
    <nav aria-label={tw.title} className="no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ol className="flex min-w-max items-center gap-1">
        {steps.map((key, pos) => {
          const i = STEPS.indexOf(key)
          const active = i === step
          const done = i < step
          const reachable = i <= maxStep && !saving && key !== 'save'
          return (
            <li key={key} className="flex items-center gap-1">
              {pos > 0 && <span aria-hidden className={cx('h-0.5 w-4 rounded-full lg:w-6', i <= step ? 'bg-brand' : 'bg-line')} />}
              <button
                type="button"
                disabled={!reachable}
                aria-current={active ? 'step' : undefined}
                title={tw.steps[key]}
                onClick={() => {
                  if (!active) onStep(i)
                }}
                className={cx(choiceClass({ selected: active, shape: 'pill' }), 'group gap-2 py-1 pr-3 pl-1 font-semibold')}
              >
                <span
                  aria-hidden
                  className={cx(
                    'tabular inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-sm',
                    active
                      ? 'border-brand bg-brand text-white'
                      : done
                        ? 'border-brand bg-paper text-brand'
                        : 'border-line bg-paper text-muted',
                  )}
                >
                  {done ? <Check className="size-4" strokeWidth={2.5} /> : pos + 1}
                </span>
                <span className="sr-only">{pos + 1}</span>
                <span className={cx('whitespace-nowrap', !active && 'max-2xl:sr-only')}>{tw.steps[key]}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Usta sahifasi: sarlavha + "Bekor qilish", stepper, joriy bosqich kartochkasi. */
export function WizardFrame({
  stepKey,
  step,
  maxStep,
  saving,
  onStep,
  onCancel,
  children,
  steps = STEPS,
}: {
  steps?: readonly StepKey[]
  stepKey: StepKey
  step: number
  maxStep: number
  saving: boolean
  onStep: (i: number) => void
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tw.title}
        actions={
          <Button variant="secondary" disabled={saving} icon={<X aria-hidden className="size-5" strokeWidth={1.75} />} onClick={onCancel}>
            {tw.cancel}
          </Button>
        }
      />
      <WizardStepper step={step} maxStep={maxStep} saving={saving} onStep={onStep} steps={steps} />
      <section aria-label={tw.steps[stepKey]} className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-4 md:p-6">
        <div className="flex flex-col gap-0.5">
          <p className="tabular text-sm text-muted">{tw.stepOf(Math.max(0, steps.indexOf(stepKey)) + 1, steps.length)}</p>
          <h2 className="text-xl font-semibold text-ink">{tw.steps[stepKey]}</h2>
        </div>
        {children}
      </section>
    </div>
  )
}
