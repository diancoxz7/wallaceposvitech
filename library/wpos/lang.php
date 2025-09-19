<?php
// library/wpos/lang.php
if (session_status() === PHP_SESSION_NONE) session_start();

/**
 * get base path to project root (folder yang berisi folder lang/)
 */
$WPOS_BASE = realpath(__DIR__ . '/../../') . '/';

/**
 * detect/save current language (POST -> SESSION -> COOKIE -> fallback 'en')
 */
if (isset($_POST['wpos_lang'])) {
    $wpos_lang = $_POST['wpos_lang'];
    $_SESSION['wpos_lang'] = $wpos_lang;
    setcookie('wpos_lang', $wpos_lang, time()+60*60*24*365, '/');
} else if (isset($_SESSION['wpos_lang'])) {
    $wpos_lang = $_SESSION['wpos_lang'];
} else if (isset($_COOKIE['wpos_lang'])) {
    $wpos_lang = $_COOKIE['wpos_lang'];
} else {
    $wpos_lang = 'en';
}

/**
 * load translations from lang/<code>.json
 */
function loadTranslations($lang) {
    global $WPOS_BASE;
    $file = $WPOS_BASE . 'lang/' . $lang . '.json';
    if (file_exists($file)) {
        $json = file_get_contents($file);
        $arr = json_decode($json, true);
        if (is_array($arr)) return $arr;
    }
    return [];
}

$WPOS_TRANSLATIONS = loadTranslations($wpos_lang);

/**
 * PHP helper to translate a key
 */
function __t($key) {
    global $WPOS_TRANSLATIONS;
    return isset($WPOS_TRANSLATIONS[$key]) ? $WPOS_TRANSLATIONS[$key] : $key;
}

/**
 * echo JS translations (so frontend JS can use)
 */
function echoTranslationsForJS() {
    global $WPOS_TRANSLATIONS, $wpos_lang;
    echo "<script>\n";
    echo "window.WPOS_LANG = " . json_encode($wpos_lang) . ";\n";
    echo "window.WPOS_TRANSLATIONS = " . json_encode($WPOS_TRANSLATIONS) . ";\n";
    echo "function t(key){ return (window.WPOS_TRANSLATIONS && window.WPOS_TRANSLATIONS[key])? window.WPOS_TRANSLATIONS[key] : key; }\n";
    echo "</script>\n";
}
