package com.junorion.starmap;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;

/**
 * Next.js 정적 결과(out/)를 그대로 담아 띄우는 얇은 WebView 껍데기.
 * 하늘지도 로직은 전부 웹 쪽에 있고, 여기서는 자산 서빙, 위치 권한, 뒤로 가기만 잇는다.
 */
public class MainActivity extends Activity {

    /** 앱 자산을 내주는 가상 https 출처. 실제 네트워크로는 나가지 않는다. */
    private static final String ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final int REQUEST_LOCATION = 1;

    private WebView web;
    private WebViewAssetLoader assetLoader;

    // 웹이 위치를 물었을 때 안드로이드 권한 대화상자의 답을 기다리는 요청
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // targetSdk 35 부터 앱은 시스템 바 아래까지(edge-to-edge) 그려진다.
        // 웹 쪽이 env(safe-area-inset-*) 로 위치 줄과 버튼을 시스템 바에서 피한다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new SiteHandler())
                .build();

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // 첫 프레임이 흰색으로 번쩍이지 않게 창 배경(res/values/colors.xml)과 같은 색을 깔아둔다.
        web.setBackgroundColor(getColor(R.color.app_background));
        // 하늘과 지도를 번갈아 보는 동안 화면이 꺼지지 않게 한다.
        web.setKeepScreenOn(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // "더 이상 안내하지 않기" 같은 설정을 localStorage 에 저장한다.
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        // 자산은 가상 https 출처로만 읽으므로 파일시스템 접근은 열어두지 않는다.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        // 확대·축소는 지도가 직접 처리한다(핀치). 페이지 확대는 막는다.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // 기기 글꼴 크기 설정에 레이아웃이 흔들리지 않게 고정한다.
        s.setTextZoom(100);
        // 웹이 앱 안에서 열렸음을 알 수 있게 표시를 붙인다. 웹은 이걸 보고 태블릿처럼 넓은 화면에서도
        // 제목과 휴대폰 모양 틀 없이 지도를 화면 전체로 그린다(app/layout.tsx).
        s.setUserAgentString(s.getUserAgentString() + " StarmapAndroid/1");

        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new GeoChromeClient());

        setContentView(web);
        web.loadUrl(ORIGIN + "/");

        // targetSdk 36(Android 16)부터는 예측형 뒤로 가기가 기본이라 onBackPressed() 가 불리지 않는다.
        // 콜백을 등록해야 뒤로 가기가 웹에 먼저 전달된다. API 32 이하는 아래 onBackPressed() 가 받는다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::askWebThenClose);
        }
    }

    /** 가상 출처의 요청을 앱 자산으로 답하고, 그 밖으로는 나가지 않는다. */
    private final class AssetClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return !(ORIGIN.equals(u.getScheme() + "://" + u.getHost()));
        }
    }

    /**
     * 경로를 assets/ 의 파일로 바꿔 준다. Next.js 정적 결과는 "/" 를 index.html 로,
     * "/_not-found" 같은 경로를 "_not-found.html" 로 내보내므로 그 규칙을 따른다.
     */
    private final class SiteHandler implements WebViewAssetLoader.PathHandler {

        @Override
        public WebResourceResponse handle(String path) {
            String file = path.isEmpty() || path.endsWith("/") ? path + "index.html" : path;
            WebResourceResponse res = open(file);
            if (res == null && !file.contains(".")) res = open(file + ".html");
            return res;
        }

        private WebResourceResponse open(String file) {
            try {
                InputStream in = getAssets().open(file);
                return new WebResourceResponse(mimeOf(file), null, in);
            } catch (IOException e) {
                return null;
            }
        }

        private String mimeOf(String file) {
            if (file.endsWith(".html")) return "text/html";
            if (file.endsWith(".js")) return "text/javascript";
            if (file.endsWith(".css")) return "text/css";
            if (file.endsWith(".json")) return "application/json";
            if (file.endsWith(".woff2")) return "font/woff2";
            if (file.endsWith(".svg")) return "image/svg+xml";
            if (file.endsWith(".png")) return "image/png";
            if (file.endsWith(".ico")) return "image/x-icon";
            if (file.endsWith(".txt")) return "text/plain";
            return "application/octet-stream";
        }
    }

    /** 웹의 navigator.geolocation 요청을 안드로이드 위치 권한으로 잇는다. */
    private final class GeoChromeClient extends WebChromeClient {

        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin, GeolocationPermissions.Callback callback) {
            if (!ORIGIN.equals(stripSlash(origin))) {
                callback.invoke(origin, false, false);
                return;
            }
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false);
                return;
            }
            pendingGeoOrigin = origin;
            pendingGeoCallback = callback;
            requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
            }, REQUEST_LOCATION);
        }

        @Override
        public void onGeolocationPermissionsHidePrompt() {
            pendingGeoOrigin = null;
            pendingGeoCallback = null;
        }
    }

    private static String stripSlash(String s) {
        return s != null && s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    private boolean hasLocationPermission() {
        // 대략 위치만 허용해도 하늘지도에는 충분하다.
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_LOCATION || pendingGeoCallback == null) return;
        // retain=false: 권한이 나중에 바뀌어도 다음 요청 때 다시 확인한다.
        pendingGeoCallback.invoke(pendingGeoOrigin, hasLocationPermission(), false);
        pendingGeoOrigin = null;
        pendingGeoCallback = null;
    }

    @Override
    public void onBackPressed() {
        askWebThenClose();
    }

    /**
     * 웹 쪽 window.onAndroidBack() 에 먼저 묻는다. 가운데 창이나 별자리 팝업을 닫았으면
     * true 를 돌려주고, 그때는 앱을 닫지 않는다. 함수가 없거나 false 면 앱을 닫는다.
     */
    private void askWebThenClose() {
        if (web == null) return;
        web.evaluateJavascript(
            "(function(){ try { return typeof window.onAndroidBack === 'function'"
          + "  && window.onAndroidBack() === true; } catch (e) { return false; } })();",
            value -> {
                // 뒤로 가기를 빠르게 두 번 누르면 두 번째 답이 이미 닫히는 중에 올 수 있다.
                if (!"true".equals(value) && !isFinishing()) finish();
            });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        // 액티비티보다 WebView 가 오래 남아 새는 것을 막는다.
        if (web != null) {
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
