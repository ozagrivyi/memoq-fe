#!/usr/bin/env bash
# Rebuild the memoq-ui image and roll it out to the local kind cluster.
set -euo pipefail
cd "$(dirname "$0")"

docker build -t memoq-ui:latest .
kind load docker-image memoq-ui:latest --name memoq
kubectl --context kind-memoq apply -f k8s/deployment.yaml
kubectl --context kind-memoq apply -f k8s/nginx-auth-configmap.yaml
kubectl --context kind-memoq -n memoq rollout restart deployment/memoq-ui
kubectl --context kind-memoq -n memoq rollout status deployment/memoq-ui

echo "Live at http://localhost:8081"
