# Turning on "Sign in with Google"

Elevate OS can let staff sign in with their Elevate Education Google account. It stays off until you add two values to the `.env` file. Only `@elevateeducation.in` accounts can get in, whatever you set up in Google (D-030). Someone signing in with Google for the first time gets an account with **no access** until roles are assigned (OD-009).

You need a Google Workspace administrator account for elevateeducation.in. The whole setup takes about 10 minutes.

Google renames console buttons from time to time. The labels below match Google's own help pages as of October 2026. Labels marked *(not verified)* could not be checked against the live console.

## 1. Open the Google Cloud console
1. Go to <https://console.cloud.google.com> and sign in with your `@elevateeducation.in` admin account.
2. At the top of the page, open the project picker and choose a project for Elevate OS, or click **New project** *(not verified)*, name it `Elevate OS`, and click **Create**.

## 2. Register the app (the consent screen)
1. Open the menu (top left) and go to **Google Auth Platform** → **Branding**. Older console layouts call this **APIs & Services** → **OAuth consent screen**.
2. If you see "Google Auth platform not configured yet", click **Get started**.
3. Under **App Information**, set **App name** to `Elevate OS` and choose your email as the **User support email**. Click **Next**.
4. Under **Audience**, choose **Internal**. Then only people in the Elevate Education Google Workspace can use it. Click **Next**.
5. Under **Contact Information**, enter an email address that you check. Click **Next**.
6. Under **Finish**, read the Google API Services User Data Policy, tick **I agree to the Google API Services: User Data Policy**, and click **Continue**, then **Create**.

Elevate OS asks only for the basic `openid`, `email` and `profile` scopes, so there is nothing to add under **Data Access**.

## 3. Create the client ID
1. Go to **Google Auth Platform** → **Clients** (direct link: <https://console.cloud.google.com/auth/clients>). Older layouts call this **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
2. Click **Create client**.
3. For **Application type**, choose **Web application**.
4. **Name**: `Elevate OS`.
5. Under **Authorized redirect URIs**, click **Add URI** *(not verified)* and paste exactly:
   `http://localhost:3000/api/v1/auth/google/callback`
   When Elevate OS goes live, add a second line with the live address, for example `https://<your live address>/api/v1/auth/google/callback`. It must start with `https://` and match `PLATFORM_URL` in `.env` exactly.
6. You can leave **Authorized JavaScript origins** empty.
7. Click **Create**.
8. A window shows the **Client ID** and **Client secret**. **Copy both now.** Google shows the full secret only once. If you lose it, open the client and click **Add secret** to make a new one.

## 4. Put the values in `.env`
1. Open the `.env` file in the `elevate-os` folder. It is the same file that holds `SESSION_SECRET`, and it is never committed.
2. Fill in the two lines (paste your own values; keep no spaces around `=`):
   ```
   GOOGLE_CLIENT_ID=<the Client ID, ending in .apps.googleusercontent.com>
   GOOGLE_CLIENT_SECRET=<the Client secret>
   ```
3. Check that `PLATFORM_URL` is the address people type in the browser (`http://localhost:3000` on your computer).
4. Restart Elevate OS (`npm run dev`, or the start command you use).

## 5. Check it works
1. Open <http://localhost:3000/login>. A **Sign in with Google** button now sits above the email and password fields.
2. Click it, choose your `@elevateeducation.in` account, and you come back signed in.
3. A first-time user sees **No access**: "Your account has no role that opens Elevate OS." That is expected: signing in gives no access by itself.
4. After they have signed in, an administrator opens **Users & roles** (`/admin/users`, or **Settings** in the sidebar), filters by **No roles yet**, opens the person, ticks their roles and clicks **Save roles**. The change applies on their next page load.

The very first administrator: before go-live, put your own `@elevateeducation.in` email in `BOOTSTRAP_OWNER_EMAILS` in `.env` and restart. When you sign in, you get the platform administrator and director roles.

## If something goes wrong
| What you see | What to do |
|---|---|
| No Google button | One of the two values is missing from `.env`, or Elevate OS was not restarted. |
| Google says `redirect_uri_mismatch` | The address in step 3.5 does not exactly match `PLATFORM_URL` + `/api/v1/auth/google/callback`. Fix it in the console; it can take a few minutes to apply. |
| Google says `org_internal` | The account is outside the Elevate Education Workspace. This is working as intended. |
| "That Google account is not an Elevate Education account." | The account is not an `@elevateeducation.in` Workspace account. |
| "Sign-in link expired — try again." | More than 10 minutes passed, or the browser blocked the cookie. Start again from the login page. |
| "This account is switched off." | A platform administrator has disabled this user. |

To turn Google sign-in off again, empty both lines in `.env` and restart.
