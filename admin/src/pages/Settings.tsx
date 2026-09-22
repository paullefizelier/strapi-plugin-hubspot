import * as React from "react";
import { useIntl } from "react-intl";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { getTranslation } from "../getTranslation";
import AuditSection from "../components/AuditSection";
import FailuresSection from "../components/FailuresSection";

/**
 * HubSpot settings: token + the portal that receives form conversions.
 *
 * The key never comes back to the browser — the server only ever returns whether
 * one is configured, where it comes from, and its last four characters. Portal
 * id, region and the default form GUID are not secrets: they round-trip so an
 * admin can switch test → production here instead of in .env.
 */

type SettingSource = "settings" | "config" | "env" | null;

interface HubspotFormOption {
  id: string;
  name: string;
}

type SubmissionMode = "auto" | "crm" | "forms";

interface Settings {
  configured: boolean;
  keySource: SettingSource;
  hint: string;
  portalId: string;
  region: string;
  defaultFormId: string;
  portalSource: SettingSource;
  regionSource: SettingSource;
  formSource: SettingSource;
  submissionMode?: SubmissionMode;
  writeExtraProperties?: boolean;
  syncFieldsOnPublish?: boolean;
  timelineNote?: boolean;
  forms?: HubspotFormOption[];
}

const REGIONS = ["eu1", "na1"] as const;

const HubspotSettings = () => {
  const { formatMessage } = useIntl();
  const { get, put, del } = useFetchClient();
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [portalId, setPortalId] = React.useState("");
  const [region, setRegion] = React.useState("eu1");
  const [defaultFormId, setDefaultFormId] = React.useState("");
  const [submissionMode, setSubmissionMode] = React.useState<SubmissionMode>("auto");
  const [writeExtraProperties, setWriteExtraProperties] = React.useState(true);
  const [syncFieldsOnPublish, setSyncFieldsOnPublish] = React.useState(false);
  const [timelineNote, setTimelineNote] = React.useState(true);
  const [forms, setForms] = React.useState<HubspotFormOption[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const apply = (data: Settings) => {
    setSettings(data);
    setPortalId(data.portalId ?? "");
    setRegion(data.region || "eu1");
    setDefaultFormId(data.defaultFormId ?? "");
    setSubmissionMode(data.submissionMode === "crm" || data.submissionMode === "forms" ? data.submissionMode : "auto");
    setWriteExtraProperties(data.writeExtraProperties !== false);
    setSyncFieldsOnPublish(data.syncFieldsOnPublish === true);
    setTimelineNote(data.timelineNote !== false);
    setForms(Array.isArray(data.forms) ? data.forms : []);
  };

  const load = React.useCallback(async () => {
    const { data } = await get<Settings>(`/${PLUGIN_ID}/settings`);
    apply(data);
  }, [get]);

  React.useEffect(() => {
    load().catch(() =>
      setFeedback({ tone: "danger", text: t("settings.load-error", "Could not load settings.") }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await put(`/${PLUGIN_ID}/settings`, {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        portalId,
        region,
        defaultFormId,
        submissionMode,
        writeExtraProperties,
        syncFieldsOnPublish,
        timelineNote,
      });
      setApiKey("");
      await load();
      setFeedback({ tone: "success", text: t("settings.saved", "Settings saved.") });
    } catch {
      setFeedback({ tone: "danger", text: t("settings.save-error", "Could not save settings.") });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await del(`/${PLUGIN_ID}/settings`);
      setApiKey("");
      await load();
      setFeedback({ tone: "success", text: t("settings.removed", "Key removed.") });
    } catch {
      setFeedback({ tone: "danger", text: t("settings.remove-error", "Could not remove the key.") });
    } finally {
      setBusy(false);
    }
  };

  /** Round-trips to HubSpot, bypassing the cache, and reports what came back. */
  const test = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { data } = await get<{ configured: boolean; properties: unknown[] }>(
        `/${PLUGIN_ID}/properties?refresh=1`,
      );
      setFeedback(
        data.configured
          ? {
              tone: "success",
              text: t("settings.test-ok", "Connection established — {count} readable properties.", {
                count: data.properties.length,
              }),
            }
          : { tone: "danger", text: t("settings.test-no-key", "No key configured.") },
      );
      if (data.configured) await load();
    } catch {
      setFeedback({
        tone: "danger",
        text: t("settings.test-error", "HubSpot unreachable — invalid or revoked key?"),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <Box padding={8}>
        <Loader small>{t("settings.loading", "Loading…")}</Loader>
      </Box>
    );
  }

  const sourceLabel: Record<Exclude<SettingSource, null>, string> = {
    settings: t("settings.source.settings", "set here"),
    config: t("settings.source.config", "config/plugins.ts"),
    env: t("settings.source.env", "environment variable"),
  };

  const sourceHint = (source: SettingSource) =>
    source && source !== "settings" ? (
      <Typography variant="pi" textColor="neutral600">
        {t("settings.source", "source: {source}", { source: sourceLabel[source] })}
      </Typography>
    ) : null;

  const regionOptions = REGIONS.includes(region as (typeof REGIONS)[number])
    ? [...REGIONS]
    : [region, ...REGIONS];

  return (
    <Box padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="alpha">HubSpot</Typography>
          <Typography variant="epsilon" textColor="neutral600">
            {t(
              "settings.subtitle",
              "Private app token and the HubSpot account that receives form conversions. Switch test → production here — nothing is hardcoded.",
            )}
          </Typography>
        </Flex>

        <Flex gap={2} alignItems="center">
          <Badge active={settings.configured}>
            {settings.configured
              ? t("settings.configured", "Configured {hint}", { hint: settings.hint })
              : t("settings.not-configured", "Not configured")}
          </Badge>
          {settings.keySource ? (
            <Typography variant="pi" textColor="neutral600">
              {t("settings.source", "source: {source}", { source: sourceLabel[settings.keySource] })}
            </Typography>
          ) : null}
        </Flex>

        <Box maxWidth="32rem">
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root
              name="apiKey"
              hint={t(
                "settings.key.hint",
                "A key entered here overrides config/plugins.ts and HUBSPOT_API_KEY.",
              )}
            >
              <Field.Label>{t("settings.key.label", "Private app token")}</Field.Label>
              <Field.Input
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={
                  settings.configured
                    ? t("settings.key.placeholder.set", "•••••••• (leave empty to keep)")
                    : t("settings.key.placeholder.empty", "pat-eu1-…")
                }
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              />
              <Field.Hint />
            </Field.Root>

            <Field.Root
              name="portalId"
              hint={t(
                "settings.portal.hint",
                "HubSpot account id (Settings → Account → Account setup). Test portal today, production later.",
              )}
            >
              <Field.Label>{t("settings.portal.label", "Portal ID")}</Field.Label>
              <Field.Input
                type="text"
                value={portalId}
                autoComplete="off"
                placeholder="148991818"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPortalId(e.target.value)}
              />
              <Field.Hint />
              {sourceHint(settings.portalSource)}
            </Field.Root>

            <Field.Root name="region">
              <Field.Label>{t("settings.region.label", "Region")}</Field.Label>
              <SingleSelect
                value={region}
                onChange={(value: string | number) => setRegion(String(value))}
              >
                {regionOptions.map((r) => (
                  <SingleSelectOption key={r} value={r}>
                    {r === "eu1"
                      ? t("settings.region.eu1", "Europe (eu1)")
                      : r === "na1"
                        ? t("settings.region.na1", "North America (na1)")
                        : r}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              {sourceHint(settings.regionSource)}
            </Field.Root>

            <Field.Root
              name="defaultFormId"
              hint={t(
                "settings.form.hint",
                "Marketing form that receives submissions when a builder form doesn't pick its own. Create the form in HubSpot, then pick it here.",
              )}
            >
              <Field.Label>{t("settings.form.label", "Default marketing form")}</Field.Label>
              {forms.length ? (
                <SingleSelect
                  value={defaultFormId}
                  placeholder={t("settings.form.placeholder", "Pick a form of the connected portal")}
                  onChange={(value: string | number) => setDefaultFormId(String(value))}
                >
                  <SingleSelectOption value="">
                    {t("settings.form.none", "None — CRM upsert only")}
                  </SingleSelectOption>
                  {defaultFormId && !forms.some((f) => f.id === defaultFormId) && (
                    <SingleSelectOption value={defaultFormId}>{defaultFormId}</SingleSelectOption>
                  )}
                  {forms.map((f) => (
                    <SingleSelectOption key={f.id} value={f.id}>
                      {f.name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              ) : (
                <Field.Input
                  type="text"
                  value={defaultFormId}
                  autoComplete="off"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDefaultFormId(e.target.value.trim())
                  }
                />
              )}
              <Field.Hint />
              {sourceHint(settings.formSource)}
            </Field.Root>

            <Typography variant="delta">
              {t("settings.policy.title", "How submissions reach HubSpot")}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t(
                "settings.policy.hint",
                "Pick the policy that matches this portal. Defaults stay safe for every install: conversions when a form is linked, leftover answers still written on the contact, HubSpot forms never mutated unless you ask.",
              )}
            </Typography>

            <Field.Root
              name="submissionMode"
              hint={t(
                "settings.mode.hint",
                "Automatic uses the marketing form when one is linked, otherwise a CRM upsert. CRM-only never counts as a conversion. Forms-only prefers the Forms API and falls back to the CRM if HubSpot refuses the submit.",
              )}
            >
              <Field.Label>{t("settings.mode.label", "Submission path")}</Field.Label>
              <SingleSelect
                value={submissionMode}
                onChange={(value: string | number) => {
                  const next = String(value);
                  if (next === "crm" || next === "forms" || next === "auto") setSubmissionMode(next);
                }}
              >
                <SingleSelectOption value="auto">
                  {t("settings.mode.auto", "Automatic — form conversion if linked, else CRM")}
                </SingleSelectOption>
                <SingleSelectOption value="forms">
                  {t("settings.mode.forms", "Marketing form — native HubSpot conversions")}
                </SingleSelectOption>
                <SingleSelectOption value="crm">
                  {t("settings.mode.crm", "CRM only — upsert the contact, no form conversion")}
                </SingleSelectOption>
              </SingleSelect>
              <Field.Hint />
            </Field.Root>

            <Checkbox
              checked={writeExtraProperties}
              onCheckedChange={(checked: boolean | "indeterminate") =>
                setWriteExtraProperties(checked === true)
              }
            >
              {t(
                "settings.extra.label",
                "After a conversion, also write mapped contact fields that the HubSpot form doesn't have",
              )}
            </Checkbox>
            <Typography variant="pi" textColor="neutral600">
              {t(
                "settings.extra.hint",
                "The Forms API drops unknown fields (they 400 the submit). With this on, leftovers still land on the contact. Turn it off if HubSpot must only receive what the marketing form declares.",
              )}
            </Typography>

            <Checkbox
              checked={syncFieldsOnPublish}
              onCheckedChange={(checked: boolean | "indeterminate") =>
                setSyncFieldsOnPublish(checked === true)
              }
            >
              {t(
                "settings.sync.label",
                "On publish, add mapped contact fields that are missing on the HubSpot form",
              )}
            </Checkbox>
            <Typography variant="pi" textColor="neutral600">
              {t(
                "settings.sync.hint",
                "Strapi-first installs: a field added here appears on the HubSpot form next publish. HubSpot-first installs should leave this off — importing a form already carries its fields. Properties themselves are never created; map to ones that exist in the portal.",
              )}
            </Typography>

            <Checkbox
              checked={timelineNote}
              onCheckedChange={(checked: boolean | "indeterminate") =>
                setTimelineNote(checked === true)
              }
            >
              {t(
                "settings.note.label",
                "Also write a recap note on the contact (page, subject, answers)",
              )}
            </Checkbox>
            <Typography variant="pi" textColor="neutral600">
              {t(
                "settings.note.hint",
                "The conversion already carries the page URL (pageUri). The note puts that page plus the originating subject on the contact timeline, next to the native form submission.",
              )}
            </Typography>
          </Flex>
        </Box>

        <Flex gap={2}>
          <Button onClick={save} loading={busy}>
            {t("settings.save", "Save")}
          </Button>
          <Button variant="secondary" onClick={test} loading={busy} disabled={!settings.configured}>
            {t("settings.test", "Test connection")}
          </Button>
          <Button
            variant="danger-light"
            onClick={remove}
            loading={busy}
            disabled={settings.keySource !== "settings"}
          >
            {t("settings.remove", "Remove key")}
          </Button>
        </Flex>

        {feedback ? (
          <Typography
            variant="pi"
            textColor={feedback.tone === "success" ? "success600" : "danger600"}
          >
            {feedback.text}
          </Typography>
        ) : null}

        <Box paddingTop={4}>
          <Typography variant="pi" textColor="neutral600">
            {t(
              "settings.scopes",
              "The token needs crm.schemas.contacts.read, crm.schemas.companies.read and forms (to list and submit marketing forms). The token is never returned to the browser.",
            )}
          </Typography>
        </Box>

        <AuditSection configured={settings.configured} />

        <FailuresSection configured={settings.configured} />
      </Flex>
    </Box>
  );
};

export default HubspotSettings;
