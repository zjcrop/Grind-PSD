from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


permissions_path = ROOT / "assets" / "permissions-v1.4.js"
permissions = permissions_path.read_text(encoding="utf-8")
permissions = patch_once(
    permissions,
    "  function hiddenCloudIds() {\n    return new Set(ensurePolicyState().map((id) => String(id || \"\")));\n  }\n",
    "  function hiddenCloudIds() {\n    return new Set(ensurePolicyState().map((id) => String(id || \"\")));\n  }\n\n"
    "  function canManageLocalRecord(record) {\n"
    "    if (isAdminAccount()) return true;\n"
    "    if (record?.user?.id === state.store.user.id) return true;\n"
    "    return Boolean(state.store.cloudSync?.[record?.id]?.ownedByCurrentAccount);\n"
    "  }\n",
    "local ownership helper",
)
permissions = permissions.replace(
    "    if (!isAdminAccount() && record.user?.id !== state.store.user.id) {",
    "    if (!canManageLocalRecord(record)) {",
)
permissions = patch_once(
    permissions,
    "          verifiedAt: new Date().toISOString()\n",
    "          verifiedAt: new Date().toISOString(),\n"
    "          ownedByCurrentAccount: !isAdminAccount()\n",
    "cloud ownership marker",
)
permissions = patch_once(
    permissions,
    "    const localRecords = state.store.records.filter((record) => {\n      return isAdminAccount() || record.user?.id === state.store.user.id;\n    });",
    "    const localRecords = state.store.records.filter((record) => canManageLocalRecord(record));",
    "upload ownership filter",
)
permissions_path.write_text(permissions, encoding="utf-8")

migration_path = ROOT / "supabase" / "migrations" / "20260731_record_permissions.sql"
migration = migration_path.read_text(encoding="utf-8")
migration = patch_once(
    migration,
    "  delete from public.measurements\n  where source_app = 'grind-psd'\n    and source_record_id = p_source_record_id;\n",
    "  delete from public.measurement_fractions f\n"
    "  using public.measurements m\n"
    "  where f.measurement_id = m.id\n"
    "    and m.source_app = 'grind-psd'\n"
    "    and m.source_record_id = p_source_record_id;\n\n"
    "  delete from public.measurements\n"
    "  where source_app = 'grind-psd'\n"
    "    and source_record_id = p_source_record_id;\n",
    "admin fraction cleanup",
)
migration_path.write_text(migration, encoding="utf-8")

print("Patched v1.4 legacy ownership and admin deletion cleanup.")
