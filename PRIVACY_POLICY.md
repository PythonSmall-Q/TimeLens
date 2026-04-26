# TimeLens Privacy Policy

**Last Updated:** April 26, 2026

**Effective Date:** April 26, 2026

---

## TL;DR (Summary)

TimeLens is a **local-first, offline-by-default** screen time tracker. We do not collect, transmit, or share your personal data with any server, cloud service, or third party. All data—including your app usage history, window titles, to-do items, notes, and settings—is stored exclusively in a local SQLite database on your own computer. You have full ownership and control over your data at all times.

---

## 1. Scope and Applicability

This Privacy Policy applies to the TimeLens desktop application ("the App", "we", "us", or "our") distributed for Windows and macOS. It governs how we handle any information that the App accesses, processes, or stores on your device.

By downloading, installing, or using TimeLens, you acknowledge that you have read and understood this Privacy Policy.

---

## 2. Information We Collect

TimeLens operates entirely on your local device. The App does **not** require user registration, login credentials, or an internet connection to function. The following categories of information are accessed or stored **locally only**:

### 2.1 Screen Time and Activity Data

To provide core screen-time tracking functionality, TimeLens periodically polls the operating system to identify the foreground application. The following fields are recorded in your local database:

| Data Field | Description | Example |
|---|---|---|
| `app_name` | Friendly name of the active application | "Visual Studio Code", "WeChat" |
| `exe_path` | Full file path of the executable | `C:\Program Files\Code.exe` |
| `window_title` | Title text of the active window | `lib.rs - TimeLens - VS Code` |
| `active_seconds` | Duration (in seconds) the app was in focus | 120 |
| `date` | The calendar date of the session | 2026-04-26 |
| `first_seen_at` | Timestamp when the app first became active | 2026-04-26T09:15:00 |
| `last_seen_at` | Timestamp when the app lost focus | 2026-04-26T09:17:00 |

**Important:** This data is never transmitted off your device. It is used solely to generate the dashboards, charts, and usage statistics displayed within the App.

### 2.2 User-Generated Content

Content that you voluntarily create within the App is stored locally:

- **To-Do Items:** The text content, completion status, creation time, and order of your to-do list entries.
- **Notes:** Text entered into the Note widget (if applicable).
- **Timer Events:** Start/stop times and labels for timer widgets.

### 2.3 Application Settings and Preferences

Your configuration choices are saved locally to restore your experience across sessions:

- Language preference (e.g., English, 简体中文)
- Launch-at-startup setting
- Silent-startup setting
- Global shortcut bindings
- Widget configurations (position, size, opacity, always-on-top mode, etc.)
- Ignored applications list (apps you have chosen to exclude from tracking)
- Auto-open widgets preference

### 2.4 Process Enumeration (Transient)

When you configure application usage limits, TimeLens may invoke the operating system's process list (`tasklist` on Windows) to present you with a selectable list of currently running executables. This enumeration is performed **in real time, in memory only**, and is not persisted to the database unless you explicitly save a limit rule.

### 2.5 What We Do **Not** Collect

TimeLens does **not** collect, store, or process:

- Your name, email address, phone number, or any other contact information.
- Your IP address, MAC address, or network activity.
- Files, documents, keystrokes, clipboard contents, or screenshots.
- Precise geolocation data.
- Any data from other users of your computer (unless they use the same OS user profile, in which case the local database is shared at the OS level).
- Analytics, telemetry, crash reports, or usage statistics sent to external servers.

---

## 3. How We Use Your Information

All processing is performed locally on your device. We use the collected information for the following purposes:

1. **To display usage statistics:** Aggregating screen-time data into daily, weekly, and monthly views, charts, and rankings.
2. **To enforce limits:** Comparing real-time activity against user-defined time limits and triggering local notifications when thresholds (80%, 90%, 100%) are reached.
3. **To restore your workspace:** Saving widget layouts and settings so they persist across app restarts.
4. **To manage your tasks:** Storing and displaying your to-do lists and notes.
5. **To improve the App (locally):** Generating insights such as hourly usage distributions or period-over-period comparisons entirely within the local database.

---

## 4. Data Storage and Local-First Architecture

### 4.1 Storage Location

All data is stored in a single SQLite database file located in your operating system's standard application data directory:

- **Windows:** `%APPDATA%\com.timelens.app\timelens.db`
- **macOS:** `~/Library/Application Support/com.timelens.app/timelens.db`

You can access, back up, or delete this file directly using your file manager.

### 4.2 No Cloud or Network Transmission

TimeLens does **not**:
- Connect to remote servers to upload your usage data.
- Use cloud databases, SaaS backends, or CDN analytics.
- Embed third-party tracking SDKs (e.g., Google Analytics, Mixpanel, Sentry, Firebase).

The only network-related functionality is the optional **update check** (if implemented), which queries a public release manifest to determine whether a newer version is available. This request does not include any personal data or usage statistics.

### 4.3 Future Sync Features (Roadmap Notice)

Our public roadmap includes a planned end-to-end encrypted sync feature (targeted for v0.9.x). If and when this feature is implemented:
- Sync will be **opt-in** only.
- Data will be encrypted on your device **before** transmission using keys that remain on your device.
- We will update this Privacy Policy to reflect the specific encryption protocols and storage endpoints used.

Until such a feature is explicitly enabled by you, no data leaves your device.

---

## 5. Data Security

We employ the following measures to protect your local data:

- **File System Permissions:** The SQLite database resides in your user-specific application data folder, protected by your operating system's standard user-access controls.
- **WAL Mode:** The database uses SQLite Write-Ahead Logging (WAL) mode for improved integrity and concurrency safety.
- **No External Exposure:** Because no data is transmitted over the network, there is no risk of interception in transit.

**Your Responsibility:** Since the data is stored locally on your machine, its security also depends on the overall security of your device. We recommend using full-disk encryption (e.g., BitLocker on Windows, FileVault on macOS) and keeping your operating system up to date.

---

## 6. Third-Party Services and Data Sharing

### 6.1 No Data Sharing

We do **not** sell, rent, trade, or otherwise share your data with any third party. There are no advertising partners, data brokers, or analytics providers integrated into TimeLens.

### 6.2 Open-Source Dependencies

TimeLens is built upon open-source frameworks, primarily Tauri (Rust + WebView). These frameworks run entirely on your local machine and do not independently exfiltrate data. You may inspect the source code and dependency tree in our public repository.

### 6.3 Optional Third-Party APIs (Future)

If future widgets (e.g., weather) require calling third-party APIs, such calls will:
- Be initiated only when the relevant widget is active.
- Use API keys provided and configured **by you**.
- Transmit only the minimum data required by the API endpoint (e.g., a city name for weather).
- Be explicitly documented in the widget settings.

No screen-time or personal data will ever be sent to these APIs.

---

## 7. Your Rights and Control

You retain full control over your data. The App provides the following mechanisms:

### 7.1 Access and Portability

You can export your entire database at any time:
- **JSON Export:** A complete, structured backup of all tables (app usage, todos, widgets, settings).
- **CSV Export:** Your app usage history in a spreadsheet-compatible format.

Exports are written to a location of your choosing on your local filesystem.

### 7.2 Correction and Deletion

- **Delete Individual Records:** Not directly exposed in the UI, but you may delete rows by editing the SQLite database file with standard database tools.
- **Delete All Data:** Uninstalling the App and removing the application data directory (`com.timelens.app`) will permanently erase all stored information.
- **Import/Reset:** The JSON import function allows you to overwrite the entire database, effectively enabling bulk correction or restoration.

### 7.3 Restriction of Processing

- **Pause Tracking:** You can pause screen-time monitoring at any time via the system tray menu or in-app controls. While paused, no new activity segments are recorded.
- **Ignore Apps:** You can add specific executables to an ignore list. Once ignored, the App stops recording time for those applications.

### 7.4 GDPR, CCPA, and PIPL Compliance

Because TimeLens processes data locally and does not act as a data controller for any remote service, traditional cross-border data transfer concerns do not apply. However, we respect the principles embodied in these regulations:

- **Lawfulness, Fairness, and Transparency:** We process data only for the purpose of providing the App's features, and we inform you fully via this policy.
- **Data Minimization:** We collect only the data strictly necessary for screen-time tracking.
- **Purpose Limitation:** We do not use your data for any purpose other than those stated in Section 3.
- **Storage Limitation:** See Section 8 below.
- **Accountability:** We maintain this policy and welcome inquiries.

If you are in the European Economic Area (EEA), California, or China and have questions about your rights under GDPR, CCPA, or PIPL, please contact us (Section 14).

---

## 8. Data Retention

TimeLens retains your data indefinitely until you choose to delete it. There is no automatic expiration or pruning of historical records (unless you explicitly configure a cleanup setting in the future).

If you wish to remove your data:
1. Use the export feature to create a backup if desired.
2. Uninstall TimeLens.
3. Manually delete the application data directory:
   - Windows: `%APPDATA%\com.timelens.app\`
   - macOS: `~/Library/Application Support/com.timelens.app/`

Once deleted, the data cannot be recovered.

---

## 9. Cookies and Similar Technologies

TimeLens is a desktop application, not a website. We do not use cookies, web beacons, local storage for tracking, or browser fingerprinting. The WebView runtime used to render the user interface does not persist cross-session web storage for tracking purposes.

---

## 10. Children's Privacy

TimeLens is not directed at children under the age of 13 (or the equivalent minimum age in your jurisdiction). We do not knowingly collect personal information from children. Because the App operates locally without accounts, we have no mechanism to determine the age of a user. If you are a parent or guardian and believe your child has provided personal information through the use of TimeLens (e.g., by typing identifiable information into a note or to-do item), you can delete that data by removing the local database file.

---

## 11. International Users

TimeLens is distributed globally. Regardless of your location, your data remains on your local device. By using the App, you acknowledge that you are subject to the data protection laws of your local jurisdiction, and we commit to complying with applicable privacy laws to the extent required by our role as the developer of a local-only application.

---

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our practices, features, or legal requirements. If we make material changes, we will:
- Update the "Last Updated" date at the top of this document.
- Notify users through the App's UI (e.g., a banner on first launch after an update) or via our release notes.
- Continue to uphold the core principle that screen-time data is local-first unless you explicitly opt into a future sync feature.

We encourage you to review this policy periodically. Continued use of TimeLens after changes constitutes acceptance of the revised policy.

---

## 13. Open Source and Transparency

TimeLens is an open-source project. You are welcome to inspect the source code to verify our privacy claims:

- **Repository:** Available at the project's public GitHub repository.
- **Build Reproducibility:** You may build the App from source to ensure the distributed binary matches the published code.
- **Dependency Audit:** The `Cargo.lock` and `package-lock.json` files provide a complete, version-locked dependency tree for independent security review.

---

## 14. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:

- **GitHub Issues:** [https://github.com/seans/TimeLens/issues](https://github.com/seans/TimeLens/issues)
- **Email:** privacy@timelens.app *(placeholder—update with real contact if available)*

We will make every effort to respond to legitimate inquiries within 30 days.

---

## 15. Legal Disclaimers

This Privacy Policy is provided in good faith to accurately describe the data practices of TimeLens as of the effective date. The App is provided "as is" without warranties of any kind. To the maximum extent permitted by law, the developers shall not be liable for any indirect, incidental, or consequential damages arising from your use of the App or your management of local data.

---

*Thank you for trusting TimeLens with your time. We built this App because we believe your screen-time data is yours and yours alone.*
