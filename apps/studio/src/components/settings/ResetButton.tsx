// ResetButton (S6): the 恢复默认设置 action shared by the settings shell
// header (全部重置) and the 隐私与数据 page — elegant confirm modal, runs
// POST /api/settings/reset (all nine sections), re-applies theme + interface
// prefs, inline error on failure. Destructive, hence never without confirm.
import { useState } from "react";
import { useStudio } from "../../store";
import { Button, Modal, Spinner } from "../ui";

export function ResetButton({ label = "全部重置" }: { label?: string }): JSX.Element {
  const resetAllSettings = useStudio((s) => s.resetAllSettings);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <Button className="danger" onClick={() => { setError(null); setConfirming(true); }} title="全部设置恢复为默认值（九大类）">
        {label}
      </Button>
      {confirming ? (
        <Modal title={label} onClose={() => (busy ? undefined : setConfirming(false))}>
          <p className="wiz-confirm-text">
            将把九大类设置全部恢复为默认值，包括已配置的供应商列表、Agent 权限覆盖与渲染参数（API Key 安全存储保留，但需重新添加供应商条目）。确定继续吗？
          </p>
          {error !== null ? (
            <div className="set-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>
              {busy ? <Spinner label="恢复中…" /> : "恢复默认"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
