// PermissionsModal (v0.2 §6 issue #54): the Agent 权限 modal (chat left
// footer 「权限」 chip). Thin shell since S6 — the editor body lives in
// components/settings/AgentPolicyEditor.tsx (shared with the settings center
// Agent 与自主性 page); this file keeps only the modal chrome. Behavior is
// identical to the pre-refactor modal (zero regression).
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { Modal } from "../ui";
import { AgentPolicyEditor } from "../settings/AgentPolicyEditor";

export function PermissionsModal(): JSX.Element {
  const { t } = useI18n();
  const open = useStudio((s) => s.permissionsOpen);
  const close = useStudio((s) => s.closePermissions);

  if (!open) return <></>;

  return (
    <Modal title={t("permissions.title")} wide onClose={close}>
      <AgentPolicyEditor />
    </Modal>
  );
}
