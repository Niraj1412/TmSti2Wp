package com.arthenica.smartexception.java;

import java.io.PrintWriter;
import java.io.StringWriter;

public final class Exceptions {
    private Exceptions() {
        // Utility class.
    }

    public static void registerRootPackage(String rootPackage) {
        // No-op fallback for missing SmartException dependency.
    }

    public static String getStackTraceString(Throwable throwable) {
        if (throwable == null) {
            return "";
        }
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        throwable.printStackTrace(pw);
        pw.flush();
        return sw.toString();
    }
}
