// Wizard step 2 (v0.2 §2, issue #48): model configuration — BYO-LLM, any vendor.
// Thin shell since S6: the provider CRUD body lives in
// components/settings/ProviderManager.tsx (shared with the settings center
// 模型与供应商 page); this file keeps only the wizard footer (上一步 /
// 演示模式 / 进入主界面) and its flow semantics. DOM is identical to the
// pre-refactor wizard step (zero regression).
import { useI18n } from "../../i18n";
import { Button } from "../ui";
import { ProviderManager, type ProviderManagerFooterCtx } from "../settings/ProviderManager";

export interface ModelStepProps {
  onBack: () => void;
  onFinish: () => void;
}

export function ModelStep({ onBack, onFinish }: ModelStepProps): JSX.Element {
  const { t } = useI18n();
  const footer = (ctx: ProviderManagerFooterCtx): JSX.Element => (
    <footer className="wizard-foot model-foot">
      <Button onClick={onBack}>{t("modelStep.back")}</Button>
      <span className="spacer" />
      {!ctx.hasEnabledEntry ? <span className="wiz-foot-hint">{t("modelStep.footHint")}</span> : null}
      <Button ghost disabled={ctx.demoBusy} onClick={ctx.onDemo}>
        {ctx.demoBusy ? t("modelStep.demoBusy") : t("modelStep.demoButton")}
      </Button>
      <Button
        variant="primary"
        disabled={!ctx.hasEnabledEntry || ctx.finishing || ctx.demoBusy}
        title={ctx.hasEnabledEntry ? undefined : t("modelStep.footHint")}
        onClick={ctx.onFinish}
      >
        {t("modelStep.enterMain")}
      </Button>
    </footer>
  );

  return <ProviderManager bodyClassName="wizard-body model-body" idPrefix="wiz" onFinish={onFinish} footer={footer} />;
}
