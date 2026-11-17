#!/bin/sh
# Alertmanager entrypoint: render the config template against this container's
# environment, then exec the real binary with the original arguments.
#
# Why render instead of mounting a static config: a webhook or SMTP receiver whose
# target is unset is invalid YAML, and Alertmanager has no conditional config. A
# file that is always valid has to be *built* from the env, and the template is
# the only honest way to do that without committing a placeholder URL that would
# either fail to load or, worse, deliver somewhere unintended.
#
# The rendered config goes to /tmp, never to the mounted config directory, which
# is read-only and host-owned. It can contain a secret (ALERT_SMTP_PASSWORD) or a
# delivery target, so it is created under a 0600 umask.
set -e

TEMPLATE=/etc/alertmanager/alertmanager.yml.tpl
RENDERED=/tmp/alertmanager.yml
RECEIVERS=/tmp/receivers.yml

umask 077

PRIMARY=workspace-log
: > "${RECEIVERS}"

# Generic webhook. One variable is enough to start delivering: Slack incoming
# webhooks, Mattermost, Discord and ntfy all accept a POST with a text body.
# Slack-native formatting needs a small relay, because Alertmanager cannot
# template a JSON field *name*, only its value.
if [ -n "${ALERT_WEBHOOK_URL}" ]; then
  PRIMARY=webhook
  cat >> "${RECEIVERS}" <<'EOF'

  - name: webhook
    webhook_configs:
      - url: '__WEBHOOK_URL__'
        send_resolved: true
        # Cap the payload. An outage on a busy route produces a group with a long
        # annotation list, and an unbounded POST to a chat API gets
        # rate-limited, which loses the page exactly when it matters.
        max_alerts: 20
EOF
fi

# SMTP. All three routing variables are required: a partial mail config is a
# config that looks enabled and silently drops alerts.
if [ -n "${ALERT_SMTP_HOST}" ] && [ -n "${ALERT_EMAIL_TO}" ] && [ -n "${ALERT_EMAIL_FROM}" ]; then
  PRIMARY=email
  cat >> "${RECEIVERS}" <<'EOF'

  - name: email
    email_configs:
      - to: '__EMAIL_TO__'
        from: '__EMAIL_FROM__'
        smarthost: '__SMTP_HOST__:__SMTP_PORT__'
        auth_username: '__SMTP_USERNAME__'
        auth_password: '__SMTP_PASSWORD__'
        require_tls: true
        send_resolved: true
EOF
fi

# awk, not sed: the values interpolated below are operator-supplied and may
# contain `/`, `&` or `|`, all of which are sed metacharacters. Awk takes them as
# data via -v and splices the receivers file in wholesale.
awk \
  -v primary="${PRIMARY}" \
  -v webhook_url="${ALERT_WEBHOOK_URL}" \
  -v email_to="${ALERT_EMAIL_TO}" \
  -v email_from="${ALERT_EMAIL_FROM}" \
  -v smtp_host="${ALERT_SMTP_HOST}" \
  -v smtp_port="${ALERT_SMTP_PORT:-587}" \
  -v smtp_username="${ALERT_SMTP_USERNAME}" \
  -v smtp_password="${ALERT_SMTP_PASSWORD}" \
  -v receivers_file="${RECEIVERS}" '
  # Busybox awk has no portable multi-line function support, so the line to emit
  # is selected into `line` and interpolated in one place. Both sources need it:
  # the values carrying the placeholders (a webhook URL, a mailbox) are exactly
  # the ones in the spliced-in receivers.
  $0 == "# {{RECEIVERS}}" {
    while ((getline line < receivers_file) > 0) {
      gsub(/\{\{PRIMARY_RECEIVER\}\}/, primary, line)
      gsub(/__WEBHOOK_URL__/, webhook_url, line)
      gsub(/__EMAIL_TO__/, email_to, line)
      gsub(/__EMAIL_FROM__/, email_from, line)
      gsub(/__SMTP_HOST__/, smtp_host, line)
      gsub(/__SMTP_PORT__/, smtp_port, line)
      gsub(/__SMTP_USERNAME__/, smtp_username, line)
      gsub(/__SMTP_PASSWORD__/, smtp_password, line)
      print line
    }
    close(receivers_file)
    next
  }
  {
    gsub(/\{\{PRIMARY_RECEIVER\}\}/, primary)
    print
  }
' "${TEMPLATE}" > "${RENDERED}"

# Fail loudly here rather than crash-looping later: a bad rendered config is
# indistinguishable from a broken receiver at 3am.
if ! /bin/amtool check-config "${RENDERED}" > /dev/null 2>&1; then
  echo "alertmanager: rendered config is invalid, refusing to start" >&2
  /bin/amtool check-config "${RENDERED}" >&2 || true
  exit 1
fi

echo "alertmanager: delivery target is '${PRIMARY}'"

exec /bin/alertmanager --config.file="${RENDERED}" "$@"
