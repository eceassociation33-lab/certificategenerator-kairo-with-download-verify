# Hosting Kairo E-Certificate Studio on Render.com

Follow these steps to host your application permanently for free and ensure your Google Drive links and verifications survive server restarts!

## 1. Prepare your Database (Crucial for Free Hosting)
Render free servers restart daily. To prevent your certificates and Drive connections from being lost:
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) and create a free account.
2. Build a **Free Cluster**.
3. Create a Database User (give it a username and password).
4. Go to **Network Access** and add `0.0.0.0/0` (Allow access from anywhere).
5. Go to **Database**, click **Connect**, choose **Drivers** (Node.js).
6. Copy the **Connection String** (it looks like `mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`).
7. Keep this string ready. (Remember to replace `<password>` with the actual password you just made).

## 2. Prepare your Code
1. Open Git Bash or terminal in your project folder.
2. Create a new **Private Repository** on [GitHub](https://github.com).
3. Commit and push your code to your new GitHub repository.

## 3. Create a Web Service on Render
1. Log in to [Render.com](https://render.com).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub account and select the repository you just pushed.

## 4. Configure the Service
Set the following values in the Render dashboard:
*   **Runtime**: `Node`
*   **Build Command**: `npm install && npm run build`
*   **Start Command**: `npm run start`

## 5. Set Environment Variables
Go to the **Environment** section (Advanced) on Render and add these variables:

| Key | Value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://your-app-name.onrender.com` *(Replace with your actual Render URL)* |
| `GOOGLE_CLIENT_ID` | Your Google Cloud Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google Cloud Client Secret |
| `MONGODB_URI` | Your MongoDB Connection String from Step 1 |

## 6. Update Google Cloud Console
Because your app is moving from `localhost` to the internet, Google needs to know it's safe!
1. Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Edit your **OAuth 2.0 Web Client**.
3. Add your Render URL to **Authorized JavaScript origins**:
   * `https://your-app-name.onrender.com`
4. Add your callback URL to **Authorized redirect URIs**:
   * `https://your-app-name.onrender.com/auth/google/callback`
5. Click **Save**.

## 7. Deploy
Render will automatically start building. Once the log says "Build Successful" and your service is "Live", you are all set!

---
**Note**: The first time you open the live app, go to the **Drive** tab and click **Connect Google Drive** to authenticate the new live environment!
