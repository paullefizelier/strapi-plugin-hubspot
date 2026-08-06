import * as React from "react";
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

const SOURCE_LABEL: Record<NonNullable<Settings["keySource"]>, string> = {
  settings: "saisie ici",
  config: "config/plugins.ts",
  env: "variable d'environnement",
};

const HubspotSettings = () => {
  const { get, put, del } = useFetchClient();
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const load = React.useCallback(async () => {
    const { data } = await get<Settings>(`/${PLUGIN_ID}/settings`);
    setSettings(data);
  }, [get]);

  React.useEffect(() => {
    load().catch(() => setFeedback({ tone: "danger", text: "Réglages illisibles." }));
  }, [load]);

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { data } = await put<Settings>(`/${PLUGIN_ID}/settings`, { apiKey });
      setSettings(data);
      setApiKey("");
      setFeedback({ tone: "success", text: "Clé enregistrée." });
    } catch {
      setFeedback({ tone: "danger", text: "Enregistrement impossible." });
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
      setFeedback({ tone: "success", text: "Clé supprimée." });
    } catch {
      setFeedback({ tone: "danger", text: "Suppression impossible." });
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
          ? { tone: "success", text: `Connexion établie — ${data.properties.length} propriétés lisibles.` }
          : { tone: "danger", text: "Aucune clé configurée." },
      );
    } catch {
      setFeedback({ tone: "danger", text: "HubSpot injoignable — clé invalide ou révoquée ?" });
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <Box padding={8}>
        <Loader small>Chargement…</Loader>
      </Box>
    );
  }

  return (
    <Box padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="alpha">HubSpot</Typography>
          <Typography variant="epsilon" textColor="neutral600">
            Le jeton d'application privée utilisé pour lire les propriétés du portail
            et valider les mappings de formulaires.
          </Typography>
        </Flex>

        <Flex gap={2} alignItems="center">
          <Badge active={settings.configured}>
            {settings.configured ? `Configurée ${settings.hint}` : "Non configurée"}
          </Badge>
          {settings.keySource ? (
            <Typography variant="pi" textColor="neutral600">
              source : {SOURCE_LABEL[settings.keySource]}
            </Typography>
          ) : null}
        </Flex>

        <Box maxWidth="32rem">
          <Field.Root
            name="apiKey"
            hint="Saisir une clé ici remplace celles venant de config/plugins.ts et de HUBSPOT_API_KEY."
          >
            <Field.Label>Jeton d'application privée</Field.Label>
            <Field.Input
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder={settings.configured ? "•••••••• (laisser vide pour conserver)" : "pat-eu1-…"}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
            />
            <Field.Hint />
          </Field.Root>
        </Box>

        <Flex gap={2}>
          <Button onClick={save} loading={busy} disabled={!apiKey.trim()}>
            Enregistrer
          </Button>
          <Button variant="secondary" onClick={test} loading={busy} disabled={!settings.configured}>
            Tester la connexion
          </Button>
          <Button
            variant="danger-light"
            onClick={remove}
            loading={busy}
            disabled={settings.keySource !== "settings"}
          >
            Supprimer
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
            Le jeton a besoin des portées <b>crm.schemas.contacts.read</b> et{" "}
            <b>crm.schemas.companies.read</b> pour lister les propriétés. Il n'est jamais
            renvoyé au navigateur : seuls son existence, sa provenance et ses quatre
            derniers caractères le sont.
          </Typography>
        </Box>
      </Flex>
    </Box>
  );
};

export default HubspotSettings;
