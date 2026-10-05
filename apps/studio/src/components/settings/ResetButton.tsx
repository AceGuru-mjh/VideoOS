// ResetButton (S6): the 恢复默认设置 action shared by the settings shell
// header (全部重置) and the 隐私与数据 page — elegant confirm modal, runs
// POST /api/settings/reset (all nine sections), re-applies theme + interface
// prefs, inline error on failure. Destructive, hence never without confirm.
// i18n: settings.reset.* keys; the store reset error ("SETTINGS_RESET_FAILED:
// detail") renders through useApiErrorMessage.
import { useState } from "react";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { Button, Modal, Spinner } from "../ui";

export function ResetButton({ label }: { label?: string }): JSX.Element {
  const resetAllSettings = useStudio((s) => s.resetAllSettings);
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // label is an already-localized string from the caller (header uses the
  // dictionary default; the privacy page passes settings.privacy.resetLabel)
  const text = label ?? t("settings.reset.all");

  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await resetAllSettings();
    setBusy(false);
    if (err !== null) {
      setError(err);
      return;
    }
    setConfirming(false);
  };

  return (
    <>
      <Button className="danger" onClick={() => { setError(null); setConfirming(true); }} title={t("settings.reset.title")}>
        {text}
      </Button>
      {confirming ? (
        <Modal title={text} onClose={() => (busy ? undefined : setConfirming(false))}>
          <p className="wiz-confirm-text">{t("settings.reset.confirmText")}</p>
          {error !== null ? (
            <div className="set-error" role="alert">
              {errText(error)}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              {t("settings.cancel")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>
              {busy ? <Spinner label={t("settings.reset.busy")} /> : t("settings.reset.confirm")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
