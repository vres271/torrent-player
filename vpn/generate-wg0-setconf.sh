#!/bin/bash
set -euo pipefail

CONF_IN="/config/wg0.conf"
CONF_OUT="/config/wg0.setconf"

need() { awk -v k="$1" '$1==k {print $3; exit}' "$CONF_IN"; }

if [[ ! -f "$CONF_IN" ]]; then
  echo "❌ Нет /config/wg0.conf"
  exit 1
fi

INTERFACE_PRIVATE_KEY="$(need PrivateKey)"
PEER_PUBLIC_KEY="$(need PublicKey)"
PEER_PRESHARED_KEY="$(need PresharedKey)"
ENDPOINT="$(need Endpoint)"

cat > "$CONF_OUT" <<EOF
[Interface]
PrivateKey = $INTERFACE_PRIVATE_KEY
Jc = 5
Jmin = 50
Jmax = 1000
S1 = 71
S2 = 129
H1 = 1049383119
H2 = 1639468902
H3 = 657775088
H4 = 1811661146

[Peer]
PublicKey = $PEER_PUBLIC_KEY
PresharedKey = $PEER_PRESHARED_KEY
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = $ENDPOINT
PersistentKeepalive = 25
EOF

echo "✅ setconf written to $CONF_OUT"
