# MikroTik Starlink Hotspot — Voucher-Based Hierarchical Dynamic QoS

## 1. Agent mission

Build a production-ready, **RouterOS v7** queueing-and-bandwidth-allocation-only configuration for a **MikroTik RB750Gr3 (hEX)** serving a paid Starlink Mini hotspot. Generate verifiable RouterOS `.rsc` scripts, documentation, tests, and rollback procedures. **Do not deploy or change a live router without operator approval.** Verify syntax and behavior against the installed RouterOS version and official MikroTik documentation; do not fabricate unsupported features.

The design must deliver **two levels of fairness**: (1) fair sharing of the global pool **between vouchers**, and (2) dynamic fair sharing of each voucher's allowance **between its active devices**. Authentication and queueing are distinct: the operator controls `shared-users` manually per existing Hotspot user profile; that setting allows concurrent sessions but does **not** make their bandwidth shared. This project must not modify that setting.

## 2. Hardware and topology

```text
Internet / Starlink Mini
         |
MikroTik RB750Gr3 (RouterOS v7)
  |-- WAN to Starlink
  |-- Hotspot authentication + DHCP/NAT/firewall
  |-- Global aggregate QoS
  |     +-- Voucher A aggregate queue (20M down / 5M up)
  |     |      +-- Dynamic device sharing
  |     +-- Voucher B aggregate queue (20M down / 5M up)
  |            +-- Dynamic device sharing
  |
ONV-H3108PS Gigabit PoE switch
  |-- TP-Link EAP225 Outdoor (bridge/AP)
  +-- Cudy AC1200 Outdoor (bridge/AP)
       +-- Hotspot client devices
```

Access points should bridge client traffic rather than create independent NAT/DHCP domains. Account for customer isolation and wireless airtime contention separately from WAN QoS.

## 3. Existing systems, ownership boundaries, and voucher identity

**Existing production stack (already deployed):**

- **Mikhmon** is the Hotspot user/voucher manager. It creates and manages vouchers, user profiles, and existing Hotspot users.
- A **payment backend hosted on a VPS** handles payment and related business logic.
- The MikroTik Hotspot captive portal authenticates voucher users.
- **This project handles ONLY traffic queueing, bandwidth allocation, and the minimal read-only session observation / queue-lifecycle automation necessary for QoS.** It is **not** a new user manager, voucher generator, payment system, subscription service, or captive portal.

| Existing plan | Price (context only) | Validity (managed externally) | Shared max download | Shared max upload | Device/session count |
|---|---:|---|---:|---:|---|
| DAILY | ₦1,000 | 24 hours | 20 Mbps | 5 Mbps | Operator-configured in existing profile |
| WEEKLY | ₦5,000 | 7 days | 20 Mbps | 5 Mbps | Operator-configured in existing profile |
| MONTHLY | ₦20,000 | 30 days | 20 Mbps | 5 Mbps | Operator-configured in existing profile |

- Each existing voucher is an **8-character alphanumeric code**, used as both Hotspot username and password. `K7P9X2AB` is a fictitious example. **Do not generate, store, rotate, validate, or change vouchers.** Treat authenticated Hotspot usernames as opaque voucher identifiers; do not log live voucher secrets unnecessarily.
- One voucher represents **one customer/account** for QoS purposes. Several concurrent sessions may use the same voucher, up to the limit **manually configured by the operator** on its existing Hotspot user profile. **Do not assume three sessions universally; do not set or overwrite `shared-users`.** The QoS design must work for any permitted number of active sessions.
- **Subscription validity starts when the voucher is created, NOT at first login.** Mikhmon / the existing management and payment stack own creation time, validity, expiration, and access revocation. QoS automation must not create, change, renew, or expire subscriptions. It should only reconcile queues against the router's authoritative active authenticated sessions and remove stale QoS state when access ends.
- Do not modify pricing, user profiles, credentials, Hotspot users, payment logic, subscription timers, or captive portal behavior. If an existing profile `rate-limit` conflicts with QoS, **report the conflict and provide a manual operator-approved remediation plan**, rather than silently changing Mikhmon-managed settings.

## 4. Configurable capacity and assumptions

```yaml
starlink:
  observed_download_range: "90-140 Mbps"   # previously observed; variable, not guaranteed
  observed_upload_range: "30-35 Mbps"      # user-reported estimate
  pool_presets:
    primary:      { download: 120M, upload: 25M }
    conservative: { download: 100M, upload: 20M }
    alternate:    { download: 110M, upload: 25M }
  active_preset: primary  # requested target, NOT necessarily safe under congestion
voucher:
  max_download: 20M
  max_upload: 5M
  max_concurrent_sessions: operator_managed_per_profile  # never hardcode or modify
sharing:
  global_scope: voucher_account
  voucher_scope: active_device
  method: demand_based_fair_queueing
```

**Important:** A configured 120 Mbps queue does not mean Starlink supplies 120 Mbps continuously. Measure aggregate WAN throughput, latency under load, and peak-hour capacity; recommend a shaping ceiling **below reliable available capacity**, with room for overhead. The operator can choose the 120M preset but must be warned of queueing/latency when actual throughput is lower. Do not claim that the reported speed test establishes a guaranteed 120 Mbps aggregate WAN rate. Upload must be shaped independently.

## 5. Non-negotiable bandwidth semantics

### 5.1 One shared allowance per voucher — not per device

All devices logged in with one voucher together have **at most 20 Mbps download and 5 Mbps upload**. Adding a device must **not** add another 20/5 Mbps entitlement.

**Do not divide 20 Mbps statically by the number of connected devices.** Any one device may reach the voucher's full 20 Mbps when the others are idle. Fairness is applied to *actively competing traffic*, not simply connected sessions.

| Devices logged in | Active demand | Illustrative result (download) |
|---|---|---|
| Any permitted count | Laptop alone demands 20M | Laptop 20M; others 0 |
| At least 3 | Phone 2M; laptop >=20M; tablet idle | Phone 2M; laptop ~18M |
| At least 3 | All three continuously demand >=20M | ~6.67M each |
| At least 3 | Phone 3M; laptop >=20M; tablet 5M | ~3M, ~12M, ~5M |
| Any permitted count | All idle | 0 total |

These are *illustrative steady-state allocations*, not fixed guarantees. Actual throughput depends on scheduler behavior, transport protocols, Wi-Fi quality, and available upstream capacity. A fair scheduler should be work-conserving: unused shares can be consumed by devices that have demand.

### 5.2 Fair sharing between vouchers

All voucher accounts compete fairly for the **global pool**. A voucher with three devices must **not** get triple the aggregate share of a voucher with one device.

- Example: 10 active vouchers each demand >=20M, global pool is actually available at 120M. Target ~12M total per voucher.
- Example: 15 active vouchers each demand >=20M, global pool is actually available at 120M. Target ~8M total per voucher.
- Example: Voucher A has 1 active device and Voucher B has 3; reduce the test pool to 20M and saturate both vouchers. Target ~10M per **voucher**, with Voucher B's ~10M dynamically shared by its three devices.
- Idle vouchers do not reserve a slice; low-demand vouchers should be able to obtain their demand while other vouchers share remaining capacity.

The system should distinguish a **per-voucher 20M ceiling** from a **temporary lower fair share** during global congestion. No hard guaranteed minimum is promised.

## 6. Required logical queue architecture

```text
GLOBAL HOTSPOT POOL (e.g. 120M download / 25M upload)
   |
   +-- VOUCHER K7P9X2AB (aggregate ceiling 20M down / 5M up)
   |     +-- Phone  [dynamic fair share, no fixed 6.67M cap]
   |     +-- Laptop [dynamic fair share, can reach full 20M]
   |     +-- Tablet [dynamic fair share]
   |
   +-- VOUCHER R4T8M2Q9 (aggregate ceiling 20M down / 5M up)
         +-- Device 1
         +-- Device 2
```

This is a **logical model**, not permission to invent arbitrary nested RouterOS queues. Select and verify a supported implementation, potentially using hierarchical Simple Queues, PCQ, Queue Trees, packet marks, Hotspot login/logout hooks, and a reconciler. Explicitly prove both fairness layers. A parent maximum alone does not necessarily ensure *fairness between child voucher queues*; select and test the relevant scheduler/priority/queue types.

**PCQ classification:** For traffic from router to hotspot clients, device subqueues commonly classify by `dst-address`; for client uploads, by `src-address`. RouterOS Simple Queue `max-limit` and Hotspot `rate-limit` use **upload/download order**, not download/upload. Carefully verify queue target, interface direction, NAT, and packet flow. If a voucher has several client IPs, per-IP PCQ *alone* does not aggregate them into one account cap. Do not create per-session Hotspot dynamic rate-limit queues that conflict with the chosen centralized hierarchy.

**Queue configuration principle:** Enforce voucher combined `max-limit` at the voucher level; within that allocation, use PCQ (or another proven work-conserving fair queueing approach) to share among active devices. Do not give each child a static `20M / device_count` ceiling, and do not interpret `pcq-rate=20M` on each IP as a shared voucher cap. Document queue discipline, `pcq-rate`, `pcq-classifier`, parent-child relations, and why they satisfy the requirements. If native RouterOS cannot meet an aspect reliably, clearly say so and propose an external controller or simpler fallback; do not claim success without testing.

## 7. Voucher-to-device association

Maintain a reliable mapping:

```text
Voucher username -> subscription plan -> active Hotspot sessions
                -> {IP address, MAC address, session ID}
                -> one voucher-level aggregate queue
                -> device membership / packet classification
```

- **First observed authenticated session:** read existing Hotspot session state; create or find exactly one voucher queue; add the device's current IP/session to its traffic classification; enforce the 20M/5M aggregate cap.
- **Additional authenticated sessions:** associate all sessions with the *same* voucher queue; do not add another entitlement. Session-count enforcement remains with the existing Hotspot profile, not this project.
- **Logout/timeout/disconnect:** remove stale membership safely; keep voucher queue while other sessions remain. An unexpected Wi-Fi disconnect may not generate an immediate logout event.
- **Reboot/reconnection/DHCP change:** reconstruct mappings from authoritative active Hotspot state. Use an idempotent reconciliation job, safe naming/ownership tags, and careful update ordering to avoid orphaned queues, incorrect IP ownership, and cross-voucher leakage.
- **Voucher expiry / access revocation:** the existing Mikhmon/Hotspot management system handles revocation; QoS only removes obsolete queue state after sessions disappear, without affecting other vouchers.
- **Security:** validate account identity using Hotspot state, not arbitrary client-provided IP/MAC claims. Protect against spoofing, shared credentials, duplicated sessions, overlapping IP mappings, and stale associations. A NAT router behind one voucher may hide downstream devices; enforce the voucher cap but document that device-level fairness behind that NAT cannot be controlled individually from the MikroTik.

## 8. RouterOS/Hotspot compatibility and safety

1. Inspect installed RouterOS version and `/export hide-sensitive` output **after the operator redacts remaining secrets**; never request raw passwords or active voucher codes. Inspect Hotspot users/profiles **read-only**, IP pools, DHCP, bridges/VLANs, NAT, firewall, mangle, existing Simple Queues/Queue Trees/queue types, and FastTrack.
2. Identify **conflicting dynamic Hotspot queues** and document operator-approved resolution; `shared-users` only governs session concurrency and remains operator-managed. Do not set or change Hotspot profile `rate-limit` automatically; explain any necessary operator-managed change if it creates independent queues per device.
3. Check FastTrack: relevant customer traffic must traverse the shaping mechanism. Exclude hotspot traffic from bypass as required without unnecessarily disabling FastTrack for unrelated flows.
4. Do not assume WAN/hotspot interface names, customer subnets, bridge names, Hotspot server name, IP addresses, or queue ordering. Use validated variables.
5. Protect management services; apply client isolation/AP isolation and appropriate firewall segmentation without disrupting Hotspot operation. Wireless airtime fairness is a separate concern.
6. Consider RB750Gr3 CPU load under firewall marking and multiple queues. Benchmark with the actual number of clients and rules.
7. Provide dry-run/check mode where possible; use Safe Mode for interactive changes, configuration backup/export, unique object names, idempotent creation/update, and a **targeted rollback**. Do not reset router or delete unrelated objects.

## 9. Monitoring and operations

Provide commands and interpretation for:

- Aggregate Starlink WAN download/upload, active QoS pool throughput, packet drops/backlog, latency during saturation, CPU/RAM.
- Per-voucher combined current download/upload, cumulative bytes, active device count, and profile (read-only); account expiration belongs to the existing user-management stack.
- Per-device current download/upload, session IP/MAC, and membership in the voucher queue.
- Active vs idle devices, queue saturation, and potential bypass/misclassification.

Document which metrics RouterOS exposes directly and which require scripts or external aggregation. Provide safe commands to switch between 120M/25M, 110M/25M, and 100M/20M presets. Do not implement continuous bandwidth-hungry speed tests without explicit approval and safeguards.

## 10. Validation / acceptance tests

Use simultaneous controlled traffic generation and router queue counters; don't infer fairness from a single speed test. Test **download and upload separately**. At minimum:

1. **Single session:** one voucher/device can reach up to 20M download / 5M upload with adequate available capacity.
2. **Multiple authenticated, one active:** one device can still approach the entire 20M, not 6.67M.
3. **Three active equally saturated (when the profile permits at least three):** combined voucher download <=20M; approximate per-device fair share ~6.67M.
4. **Unequal demand:** demand 3M, 5M, >=20M results approximately 3M, 5M, 12M under a 20M voucher bottleneck.
5. **Multi-connection bypass:** many TCP/UDP flows from one device do not multiply the voucher allowance.
6. **Per-voucher fairness:** one-device voucher vs three-device voucher under a temporarily reduced 20M global pool yields ~10M aggregate each, not 5M vs 15M.
7. **Global congestion:** 10 vouchers each saturate at >=20M with a 120M available pool -> ~12M per voucher; 15 vouchers -> ~8M per voucher (subject to available WAN capacity).
8. **Session count:** verify QoS adapts to the actual number of permitted active sessions without changing the operator-managed `shared-users` value; Hotspot session-limit enforcement is out of scope.
9. **Queue lifecycle:** first login, extra login, logout, timeout, IP reassignment, device reconnect, externally managed voucher expiry/access revocation, and reboot do not create duplicates or wrong mappings.
10. **Upload aggregate:** three devices using one voucher collectively stay <=5M upload.
11. **FastTrack/conflicting queues:** verify all customer packets traverse intended queues and limits are enforced.
12. **Capacity drop:** reduce shaping preset and test queue drops/latency/fairness; note that actual Starlink capacity below the preset can cause upstream congestion.
13. **Rollback:** restores prior working state without affecting unrelated config.

Throughput expectations are approximate and subject to measurement overhead; verify the actual queue implementation instead of declaring success from configuration syntax alone.

## 11. Deliverables and suggested repository structure

```text
mikrotik-hotspot-qos/
├── README.md
├── config/
│   ├── variables.rsc
│   └── bandwidth-presets.rsc
├── scripts/
│   ├── 01-queue-types.rsc
│   ├── 02-global-queues.rsc
│   ├── 03-voucher-queues.rsc
│   ├── 05-session-association.rsc
│   ├── 06-session-observer.rsc
│   ├── 07-session-cleanup.rsc
│   ├── 08-reconcile.rsc
│   ├── 09-firewall-compatibility.rsc
│   ├── 10-monitoring.rsc
│   └── rollback.rsc
├── tests/
│   └── validation.md
└── docs/
    ├── architecture.md
    ├── deployment.md
    ├── troubleshooting.md
    └── security.md
```

The agent may revise file decomposition to fit the **verified** RouterOS architecture. Every `.rsc` must contain valid RouterOS v7 syntax; explain how to install and test in stages. Provide operator-friendly commands to inspect state and recover from partial installation.

## 12. Required discovery before producing production scripts

Ask for or safely inspect:

```yaml
routeros_version: REQUIRED
wan_interface: REQUIRED
hotspot_interface_or_bridge: REQUIRED
hotspot_subnet_and_ip_pool: REQUIRED
hotspot_server_name: REQUIRED
existing_mikhmon_hotspot_integration_read_only: REQUIRED
existing_user_profiles_and_rate_limits: REQUIRED
existing_simple_queues_and_queue_trees: REQUIRED
existing_queue_types: REQUIRED
existing_fasttrack_nat_mangle_filter_rules: REQUIRED
existing_subscription_creation_time_and_expiration_policy: CREATED_AT_CREATION__EXTERNALLY_MANAGED
management_access_and_rollback_method: REQUIRED
```

Do not invent values. First provide a proposed queue design and an explanation of how it achieves **both levels of fairness**; identify limitations and potential conflict with the existing configuration. Only then generate deployable scripts, testing steps, and rollback instructions.

## 13. Final success criteria

**One voucher = one shared 20 Mbps download / 5 Mbps upload entitlement, regardless of how many devices are permitted and logged in.** Device bandwidth is **dynamic, demand-based, and work-conserving**: no permanent division by device count. Vouchers also share a configurable global pool fairly, independent of their device counts. QoS session association, compatibility with existing Hotspot authentication and externally managed account expiry, security, performance, monitoring, and safe rollback must all be addressed; user management, payments, and subscription lifecycle are out of scope. A 120 Mbps configured global pool is a ceiling, not a guaranteed Starlink capacity.

## 14. Explicit non-goals and integration contract

**Do not build or modify:** Mikhmon, the VPS payment backend, voucher creation, voucher password generation, captive portal pages, subscription activation/expiry, user profile creation, profile device/session limits, or user authentication policy. Subscription time begins **at voucher creation** and is owned by the existing stack.

**QoS integration contract:** Read current authenticated Hotspot sessions and their voucher usernames/IP addresses; maintain only QoS-owned queues, classifications, and reconciliation state. Never write to Mikhmon-managed account/profile fields. Make the queue configuration independent of the operator's per-profile `shared-users` values, whether a voucher currently has one, three, or another allowed number of sessions.

**Operator approval boundary:** If a preexisting Mikhmon-managed `rate-limit` or dynamic Hotspot queue prevents correct shared-voucher QoS, show the exact conflict and proposed manual adjustment. Do not silently override existing profile settings.
