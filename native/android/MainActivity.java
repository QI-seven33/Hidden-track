package com.hiddentrack.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Message;
import android.net.Uri;
import android.content.Intent;
import android.webkit.*;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.widget.Toast;

/** Hosted H5 with one persistent WebView cookie store. No JavaScript/native bridge. */
public final class MainActivity extends Activity {
    private static final String HOME = "http://43.129.205.113:3000/";
    private WebView web;
    private FrameLayout root;
    private boolean backgrounded;
    private boolean callbackPending;
    private static boolean inApp(Uri uri) {
        String host = uri.getHost(), scheme = uri.getScheme();
        return (HOME.startsWith(uri.getScheme()+"://"+uri.getAuthority()+"/") && "43.129.205.113".equals(host))
            || ("https".equals(scheme) && host != null && (host.equals("qq.com") || host.endsWith(".qq.com")));
    }
    private boolean navigate(String address) {
        try {
            Uri uri = Uri.parse(address);
            if ("hiddentrack".equals(uri.getScheme()) && "exit".equals(uri.getHost()) && gameOrigin(Uri.parse(web.getUrl()==null?HOME:web.getUrl()))) {
                finish(); return true;
            }
            if ("hiddentrack".equals(uri.getScheme()) && "oauth".equals(uri.getHost())) {
                acceptCallback(new Intent(Intent.ACTION_VIEW,uri)); return true;
            }
            if (inApp(uri)) return false;
            String scheme = uri.getScheme();
            if ("intent".equals(scheme)) {
                Intent intent = Intent.parseUri(address, Intent.URI_INTENT_SCHEME);
                String pkg = intent.getPackage();
                if (!("com.tencent.qqmusic".equals(pkg) || "com.tencent.mobileqq".equals(pkg) || "com.tencent.mm".equals(pkg))) return true;
                intent.setComponent(null); intent.setSelector(null); intent.addCategory(Intent.CATEGORY_BROWSABLE);
                try { startActivity(intent); } catch(Exception missing) {
                    String fallback = intent.getStringExtra("browser_fallback_url");
                    if (fallback != null && inApp(Uri.parse(fallback))) web.loadUrl(fallback);
                    else Toast.makeText(this,"请安装 QQ 音乐，或返回使用扫码登录",Toast.LENGTH_LONG).show();
                }
                return true;
            }
            if ("qqmusic".equals(scheme) || "mqq".equals(scheme) || "mqqapi".equals(scheme) || "weixin".equals(scheme) || "https".equals(scheme))
                startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch(Exception ignored) { Toast.makeText(this,"无法打开该链接，可返回使用扫码登录",Toast.LENGTH_LONG).show(); }
        return true;
    }
    private WebView createWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(0xfff7f7f2);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString()+" HiddenTrackAndroid/1.0");
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true); settings.setJavaScriptCanOpenWindowsAutomatically(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view,true);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) { return navigate(request.getUrl().toString()); }
            @Override public void onPageFinished(WebView v,String url) {
                CookieManager.getInstance().flush(); audioLifecycle(backgrounded);
                Uri address=Uri.parse(url);
                if(v==web && callbackPending && gameOrigin(address) && !"/api/music/auth/web/callback".equals(address.getPath())) {
                    callbackPending=false; v.clearHistory();
                }
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView source,boolean dialog,boolean gesture,Message result) {
                if (!gesture) return false;
                if(root.getChildCount()>=3)return false;
                WebView popup=createWebView();
                root.addView(popup,new FrameLayout.LayoutParams(-1,-1));
                ((WebView.WebViewTransport)result.obj).setWebView(popup);result.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView window) { if(window!=web) {root.removeView(window);window.destroy();} }
        });
        return view;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);root=new FrameLayout(this);setContentView(root);
        web=createWebView();root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        if (state==null || web.restoreState(state)==null) web.loadUrl(HOME);
        acceptCallback(getIntent());
        if(android.os.Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->goBack());
        fullscreen();
    }
    @Override protected void onNewIntent(Intent intent) {super.onNewIntent(intent);setIntent(intent);acceptCallback(intent);}
    private void acceptCallback(Intent intent) {
        Uri uri=intent.getData();
        if(uri!=null && "hiddentrack".equals(uri.getScheme()) && "oauth".equals(uri.getHost()) && uri.getEncodedQuery()!=null) {
            callbackPending=true;
            while(root.getChildCount()>1){WebView popup=(WebView)root.getChildAt(root.getChildCount()-1);root.removeView(popup);popup.destroy();}
            web.loadUrl(HOME+"api/music/auth/web/callback?"+uri.getEncodedQuery());
            intent.setData(null); // Do not replay an already consumed callback after activity recreation.
        }
    }
    private void fullscreen() {
        if (android.os.Build.VERSION.SDK_INT>=30) {
            WindowInsetsController controller=getWindow().getInsetsController();
            if(controller!=null) {controller.hide(WindowInsets.Type.statusBars()|WindowInsets.Type.navigationBars());controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);}
        } else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN);
    }
    @Override public void onWindowFocusChanged(boolean focus) {super.onWindowFocusChanged(focus);if(focus)fullscreen();}
    @Override public void onSaveInstanceState(Bundle state) {web.saveState(state);super.onSaveInstanceState(state);}
    @Override public void onBackPressed() {goBack();}
    private void goBack() {
        WebView current=(WebView)root.getChildAt(root.getChildCount()-1);
        if(current==web && gameOrigin(Uri.parse(web.getUrl()==null?HOME:web.getUrl()))) {
            web.evaluateJavascript("(()=>{if(!window.__hiddenTrackBack)return false;window.dispatchEvent(new Event('app-back'));return true})()",result->{
                if(!"true".equals(result)){if(web.canGoBack())web.goBack();else finish();}
            });return;
        }
        if(current.canGoBack())current.goBack();else if(current!=web){root.removeView(current);current.destroy();web.reload();}else finish();
    }
    private static boolean gameOrigin(Uri address) {
        Uri home=Uri.parse(HOME);
        return home.getScheme().equals(address.getScheme()) && home.getAuthority().equals(address.getAuthority());
    }
    private void audioLifecycle(boolean hidden) {
        backgrounded=hidden;
        for(int i=0;root!=null && i<root.getChildCount();i++) {
            WebView view=(WebView)root.getChildAt(i);
            Uri address=Uri.parse(view.getUrl()==null?HOME:view.getUrl());
            if(gameOrigin(address))
                view.evaluateJavascript("document.documentElement.dataset.appHidden='"+(hidden?"1":"0")+"';window.dispatchEvent(new Event('ht-"+(hidden?"background":"foreground")+"'));",null);
        }
    }
    @Override protected void onResume() {super.onResume();if(web!=null){web.onResume();audioLifecycle(false);}}
    @Override protected void onPause() {audioLifecycle(true);CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onDestroy() {
        if(root!=null)while(root.getChildCount()>0){WebView child=(WebView)root.getChildAt(root.getChildCount()-1);root.removeView(child);child.destroy();}
        super.onDestroy();
    }
}
