import * as React from "react";
import { useIntl } from "react-intl";
import { Badge, Button, Divider, Flex, Typography } from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { getTranslation } from "../getTranslation";

/**
 * The dead-letter queue, surfaced: submissions HubSpot couldn't take after the
 * in-process retries. Replaying walks the queue server-side; the rows
 * themselves are inspectable in the Content Manager (HubSpot failed
 * submissions), where a stuck payload can also be deleted.
 */
const FailuresSection = ({ configured }: { configured: boolean }) => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const [total, setTotal] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const load = React.useCallback(async () => {
    try {
      const { data } = await get<{ total: number }>(`/${PLUGIN_ID}/failures`);
      setTotal(data.total);
    } catch {
      setTotal(null);
    }
  }, [get]);

  React.useEffect(() => {
    load();
  }, [load]);

  const retry = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { data } = await post<{ retried: number; succeeded: number; failed: number }>(
        `/${PLUGIN_ID}/failures/retry`,
      );
      setFeedback({
        tone: data.failed ? "danger" : "success",
        text: t("failures.retried", "{succeeded} replayed, {failed} still failing.", {
          succeeded: data.succeeded,
          failed: data.failed,
        }),
      });
      await load();
    } catch {
      setFeedback({ tone: "danger", text: t("failures.error", "Replay failed.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Divider />

      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography variant="beta">{t("failures.title", "Failed submissions")}</Typography>
        <Typography variant="epsilon" textColor="neutral600">
          {t(
            "failures.subtitle",
            "Submissions HubSpot couldn't take after the automatic retries. They can be inspected under Content Manager → HubSpot failed submissions.",
          )}
        </Typography>
      </Flex>

      <Flex gap={2} alignItems="center">
        <Badge active={Boolean(total)}>
          {t("failures.count", "{count} queued", { count: total ?? 0 })}
        </Badge>
        <Button
          variant="secondary"
          onClick={retry}
          loading={busy}
          disabled={!configured || !total}
        >
          {t("failures.retry", "Replay now")}
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
    </Flex>
  );
};

export default FailuresSection;
