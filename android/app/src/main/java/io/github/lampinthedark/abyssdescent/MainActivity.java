package io.github.lampinthedark.abyssdescent;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Full-bleed WebView. The page itself pads for the status bar, cutout, and
 * gesture area via CSS variables. Overscroll is off so the dungeon cannot
 * rubber-band. Audio still waits for the first tap inside the page.
 */
public class MainActivity extends BridgeActivity {
    private static final int ABYSS = Color.parseColor("#0A0708");

    private int safeTop;
    private int safeRight;
    private int safeBottom;
    private int safeLeft;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        window.setBackgroundDrawable(new ColorDrawable(ABYSS));
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }
        hardenWebView();
        installInsets();
    }

    @Override
    public void onResume() {
        super.onResume();
        hardenWebView();
        WebView webView = webView();
        if (webView != null) {
            webView.post(this::pushInsets);
            webView.postDelayed(this::pushInsets, 300);
        }
    }

    private void hardenWebView() {
        WebView webView = webView();
        if (webView == null) return;
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setBackgroundColor(ABYSS);
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
    }

    private void installInsets() {
        WebView webView = webView();
        if (webView == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = view.getResources().getDisplayMetrics().density;
            if (density <= 0f) density = 1f;
            safeTop = Math.round(bars.top / density);
            safeRight = Math.round(bars.right / density);
            safeBottom = Math.round(bars.bottom / density);
            safeLeft = Math.round(bars.left / density);
            view.post(this::pushInsets);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private void pushInsets() {
        WebView webView = webView();
        if (webView == null) return;
        String js = "window.__abyssApplyInsets&&window.__abyssApplyInsets({top:"
            + safeTop + ",right:" + safeRight + ",bottom:" + safeBottom + ",left:" + safeLeft + "})";
        webView.evaluateJavascript(js, null);
    }

    private WebView webView() {
        if (getBridge() == null) return null;
        return getBridge().getWebView();
    }
}
