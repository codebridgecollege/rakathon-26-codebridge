<script setup lang="ts">
// The account menu of the header with a login (AUTH_MODE=oidc; docs/design/AUTH.md, "The frontend"), in place of the
// demo's user picker: who is logged in, the org and role, the switch to another org of the person, "Přepnout roli" in
// a demo org, and "Odhlásit". Every switch runs the session store's switch protocol (drafts stored, recording stopped).
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import type { Role } from "@codebridge/domain/access";
import { useSessionStore } from "../stores/session";

const { $t } = useFluent();
const session = useSessionStore();
const router = useRouter();
const open = ref(false);
const busy = ref(false);

const me = computed(() => session.me);
const ROLE_ID: Record<Role, string> = { doctor: "account-role-doctor", coordinator: "account-role-coordinator", admin: "account-role-admin" };
const roleText = (r: Role) => $t(ROLE_ID[r]);
const otherOrgs = computed(() => (me.value?.memberships ?? []).filter((m) => m.org.id !== me.value?.org.id));
const roles = computed(() => me.value?.role_switch ?? null);

async function act(fn: () => Promise<boolean>) {
  if (busy.value) return;
  busy.value = true;
  try {
    const ok = await fn();
    if (ok) open.value = false;
    // The administration is for administrators only; a switch away from that role leaves it.
    if (ok && router.currentRoute.value.path.startsWith("/admin") && me.value?.user.role !== "admin") void router.push("/patients");
  } finally {
    busy.value = false;
  }
}
const toOrg = (id: string) => act(() => session.switchOrg(id));
const toRole = (id: string) => act(() => session.switchRole(id));
const logout = () => act(() => session.logout());

function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Element | null;
  if (t?.closest?.(".acctwrap")) return;
  open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) open.value = false;
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <span v-if="me" class="who acctwrap">
    <button class="btn small" :aria-expanded="open" aria-haspopup="dialog" :aria-label="$t('account-button-aria', { name: me.user.name })" @click="open = !open">
      {{ me.user.name }} <span class="lbl">· {{ me.org.short_name }}</span> ▾
    </button>
    <div v-if="open" class="fpop acctpop" role="dialog" :aria-label="$t('account-menu')">
      <span><b>{{ me.user.name }}</b>, {{ roleText(me.user.role) }}</span>
      <span class="muted small">{{ me.org.name }}</span>
      <span v-if="me.real_user" class="muted small">{{ $t("account-logged-in-as", { name: me.real_user.name }) }}</span>
      <template v-if="otherOrgs.length">
        <span class="label">{{ $t("account-switch-org") }}</span>
        <button v-for="m in otherOrgs" :key="m.id" class="btn small" :disabled="busy" @click="toOrg(m.org.id)">{{ m.org.name }}</button>
      </template>
      <template v-if="roles">
        <span class="label">{{ $t("account-switch-role") }}</span>
        <button
          v-for="r in roles"
          :key="r.membership_id"
          class="btn small"
          :disabled="busy"
          :aria-pressed="r.membership_id === me.membership_id"
          @click="r.membership_id !== me.membership_id && toRole(r.membership_id)"
        >
          {{ $t("account-role-entry", { name: r.name, role: roleText(r.role) }) }}
        </button>
        <span class="muted small">{{ $t("account-switch-role-help") }}</span>
      </template>
      <button class="btn small" :disabled="busy" @click="logout">{{ $t("account-logout") }}</button>
    </div>
  </span>
</template>
