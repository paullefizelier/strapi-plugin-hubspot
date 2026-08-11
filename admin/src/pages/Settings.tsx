import * as React from "react";
import { useIntl } from "react-intl";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Typography,
} from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { getTranslation } from "../getTranslation";
import AuditSection from "../components/AuditSection";
import FailuresSection from "../components/FailuresSection";

/**
 * HubSpot settings: the private app token, saved server-side in the plugin store.
 *
 * The key never comes back to the browser — the server only ever returns whether
 * one is configured, where it comes from, and its last four characters. That way
 * an admin can recognise which key is in use without it being readable from the
 * client, and without it leaking into a browser cache or a screenshot.
 */

interface Settings {
  configured: boolean;
  keySource: "settings" | "config" | "env" | null;
  hint: string;
}

const HubspotSettings = () => {
  const { formatMessage } = useIntl();
  const { get, put, del } = useFetchClient();
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const load = React.useCallback(async () => {
    const { data } = await get<Settings>(`/${PLUGIN_ID}/settings`);
    setSettings(data);
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
      const { data } = await put<Settings>(`/${PLUGIN_ID}/settings`, { apiKey });
      setSettings(data);
      setApiKey("");
      setFeedback({ tone: "success", text: t("settings.saved", "Key saved.") });
    } catch {
      setFeedback({ tone: "danger", text: t("settings.save-error", "Could not save the key.") });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { data } = await del<Settings>(`/${PLUGIN_ID}/settings`);
      setSettings(data);
      setApiKey("");
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

  const sourceLabel: Record<NonNullable<Settings["keySource"]>, string> = {
    settings: t("settings.source.settings", "set here"),
    config: t("settings.source.config", "config/plugins.ts"),
    env: t("settings.source.env", "environment variable"),
  };

  return (
    <Box padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="alpha">HubSpot</Typography>
          <Typography variant="epsilon" textColor="neutral600">
            {t(
              "settings.subtitle",
              "The private app token used to read the portal's properties and validate form mappings.",
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
          <Field.Root
            name="apiKey"
            hint={t(
              "settings.key.hint",
              "A key entered here overrides the ones from config/plugins.ts and HUBSPOT_API_KEY.",
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
        </Box>

        <Flex gap={2}>
          <Button onClick={save} loading={busy} disabled={!apiKey.trim()}>
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
            {t("settings.remove", "Remove")}
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
              "The token needs the crm.schemas.contacts.read and crm.schemas.companies.read scopes to list properties. It is never returned to the browser: only its existence, its source and its last four characters are.",
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
