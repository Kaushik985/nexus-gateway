---
name: build-ami
description: >
  Use when building, compiling, or publishing the Nexus Gateway AWS AMI / single-instance
  appliance (the nexus-ami/ Packer image) and registering it to AWS. Covers the full pipeline
  (Go cross-compile + UI + Prisma + Packer), the EC2 vCPU-quota trap that makes the default
  m5.4xlarge fail with VcpuLimitExceeded on fresh accounts, the RAM-bound valkey-search compile
  that OOMs under 48GB, passing an AWS profile, running the ~1h build detached, and verifying the
  AMI. Trigger keywords: build ami, compile ami, publish ami, packer build, nexus-ami, push ami to aws.
---

# build-ami

Build and register the Nexus Gateway single-instance appliance AMI from `nexus-ami/`.

`nexus-ami/build.sh` cross-compiles the 4 Go services (linux/amd64), builds the Vite UI, bundles
Prisma, tarballs `artifacts/`, then runs `packer init && packer build nexus.pkr.hcl`. Packer launches
one AL2023 x86_64 EC2 instance, uploads the tarball, runs `install.sh` + `harden.sh`, snapshots, and
registers the AMI. Full build ≈ **1 hour** (the valkey-search C++ compile dominates).

## ⚠️ The two non-obvious traps (read first)

1. **vCPU quota.** The committed default instance type is **`m5.4xlarge` = 16 vCPU**. The EC2
   *Running On-Demand Standard instances* quota (`L-1216C47A`) defaults to **16** on fresh accounts,
   and m5/c5/t3/r5 all share that bucket. Any already-running instance leaves <16 free, so a default
   `./build.sh` dies in ~11s at "Launching a source AWS instance" with
   `VcpuLimitExceeded: ... current vCPU limit of 16`. **Fix: build on `r5.2xlarge`** (8 vCPU / 64 GB)
   via `-var instance_type=r5.2xlarge`.
2. **valkey-search is RAM-bound, not CPU-bound.** `install-valkey.sh` compiles valkey-search from
   source (gRPC/Protobuf/Abseil/ICU submodules), capped at `--jobs=4`. It needs **~48–64 GB RAM** —
   32 GB hosts (t3.2xlarge / r5.xlarge / m5.2xlarge) get **silently OOM-killed** mid-compile (sshd
   dies before any error is logged → confusing SSH failure after ~10 min). So when dropping vCPU to fit
   the quota, drop to a **memory-heavy `r5`**, never a smaller `m5`. `r5.2xlarge` (8 vCPU / **64 GB**) is
   the sweet spot: fits a 16-vCPU quota *and* keeps the RAM headroom. Never compile valkey-search on <48 GB.

There is no AL2023 prebuilt for valkey-search (1.2.0 is source-only; the official `valkey/valkey-bundle`
image is Debian/glibc-incompatible with the AL2023 appliance), so the source compile is mandatory.
postgres/nats/node already install prebuilt — prefer install over compile wherever a suitable build exists.

## Standard build (recommended path)

```bash
cd nexus-ami
export AWS_PROFILE=<profile>          # e.g. abc. Packer has NO --profile flag; it's env-only.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY  # static keys OVERRIDE the profile if set — clear them.

# 0. Sanity: confirm the profile resolves + check the real quota BEFORE a 1h build.
aws sts get-caller-identity --profile "$AWS_PROFILE" --region us-east-1
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A \
  --profile "$AWS_PROFILE" --region us-east-1 --query 'Quota.Value'   # need ≥ 8 free for r5.2xlarge
aws ec2 describe-instances --region us-east-1 --profile "$AWS_PROFILE" \
  --filters Name=instance-state-name,Values=running,pending \
  --query 'Reservations[].Instances[].InstanceType'   # subtract these vCPUs from the quota

# 1. Stage locally first (no AWS calls) — isolates Go/Node failures from AWS ones.
./build.sh --skip-packer             # produces artifacts.tar.gz, stops before packer

# 2. Run packer directly with the quota-safe instance type (build.sh does NOT forward -var,
#    and re-running build.sh would re-stage + use the m5.4xlarge default). Reuses the tarball.
packer init .
ts="$(date -u +%Y%m%dT%H%M%SZ)"
nohup packer build -var instance_type=r5.2xlarge nexus.pkr.hcl > "build.log.$ts" 2>&1 &
```

Run the build **detached** (it's ~1h). In this harness: launch with `run_in_background`, then start a
**tracked waiter** so you're notified on completion instead of polling:

```bash
LOG=build.log.$ts
while pgrep -f "packer build" >/dev/null 2>&1; do sleep 30; done   # run_in_background: true
tail -40 "$LOG"; grep -nE "ami-[0-9a-f]{8,}|AMIs were created|VcpuLimit|errored" "$LOG" | tail
```

Success tail:
```
--> nexus-gateway-ami.amazon-ebs.nexus: AMIs were created:
us-east-1: ami-0xxxxxxxxxxxxxxxx
```

## Verify the AMI

```bash
aws ec2 describe-images --image-ids <ami-id> --profile "$AWS_PROFILE" --region us-east-1 \
  --query 'Images[0].{State:State,Name:Name,Arch:Architecture,Snapshot:BlockDeviceMappings[0].Ebs.SnapshotId,Public:Public}'
# State must be "available". AMI is private by default.
```

## Quick reference

| Need | Command / fact |
|---|---|
| AWS auth | `export AWS_PROFILE=<p>`; clear `AWS_ACCESS_KEY_ID/SECRET` (they win over the profile) |
| Stage only, no AWS | `./build.sh --skip-packer` |
| Full build (high-quota acct) | `AWS_PROFILE=<p> ./build.sh` (uses default m5.4xlarge, 16 vCPU) |
| Build on 16-vCPU acct | `packer build -var instance_type=r5.2xlarge nexus.pkr.hcl` |
| Region / base | us-east-1; `al2023-ami-2023.*-x86_64` (owner amazon, most_recent) |
| Version / name | `var.nexus_version` (0.1.0) → `nexus-gateway-<ver>-<timestamp>` |
| Raise quota | `aws service-quotas request-service-quota-increase --service-code ec2 --quota-code L-1216C47A --desired-value 20 ...` (lets you use the faster m5.4xlarge) |

## Common failures

| Symptom | Cause → fix |
|---|---|
| `VcpuLimitExceeded ... limit of 16` at launch (~11s) | m5.4xlarge needs 16 vCPU. → `-var instance_type=r5.2xlarge`, or request a quota increase. |
| SSH error / build dies ~10 min into compile, no error in log | Silent OOM-kill — host has <48 GB. → use a 64 GB instance (r5.2xlarge); never a smaller m5/t3. |
| Profile ignored, pushes to wrong account | Static `AWS_ACCESS_KEY_ID` env overrides `AWS_PROFILE`. → `unset` them; confirm with `sts get-caller-identity`. |
| `InvalidParameterValue: Character sets beyond ASCII` modifying AMI | Non-ASCII in `ami_description`. → keep it ASCII-only. |
| README says t3.xlarge | Stale — the real default is m5.4xlarge. Trust `nexus.pkr.hcl`, not the README. |

## After the build

- The AMI is **private**. To share: `aws ec2 modify-image-attribute --image-id <ami> --launch-permission '{"Add":[{"UserId":"<acct>"}]}'` or `--launch-permission '{"Add":[{"Group":"all"}]}'` for public.
- At launch the **EC2 Security Group** (set by the launcher, not baked in) must open **443** (UI + `/v1` + agent WS), **3128** (Compliance Proxy), **22** (SSH). The AMI's internal firewalld already opens these.
- First boot generates per-instance secrets + admin login at `/root/nexus-admin-credentials.txt` (mode 0600). `https://<ip>/` serves the UI; `https://<ip>/v1/models` reaches the gateway.
- Marketplace Self-Service Scan usually needs 2–3 rebuild cycles (CVE/sshd findings) — budget for re-running `packer build`.
