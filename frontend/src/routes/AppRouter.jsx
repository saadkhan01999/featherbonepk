import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';

import { AuthProvider, StaffRoute, CustomerRoute } from '@/features/auth/authContext.jsx';
import { CartProvider } from '@/features/cart/cartContext.jsx';
import { WishlistProvider } from '@/features/wishlist/wishlistContext.jsx';
import { SiteProvider } from '@/features/site/siteContext.jsx';
import { PosAuthProvider, PosProtectedRoute } from '@/features/pos/posAuth.jsx';
import { PageLoader } from '@/components/ui/Spinner.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { ROUTES } from '@/constants/routes.js';

/**
 * Route tree.
 * ---------------------------------------------------------------------------
 * Three independent surfaces, each with its own shell and its own session:
 *
 *   /            storefront + customer account   (website session)
 *   /admin/*      back office                    (website session, staff roles)
 *   /pos/*        the till                       (separate POS token family)
 *   /kitchen      kitchen display                (website session, kitchen.view)
 *   /display      order status board             (website session, kitchen.view)
 *
 * The POS subtree sits outside <AuthProvider> on purpose. A terminal must not
 * inherit or be affected by whichever customer happens to be signed in on the
 * same browser, and its session must survive independently of the website's.
 *
 * Pages are lazily loaded, so a customer never downloads POS or admin code.
 */

/*
 * The design reference — development only.
 *
 * It is an internal page: every button variant, every badge tone, the type
 * scale. Useful while building, and not something a customer should be able to
 * reach by typing /style-guide on the live site, where it reads as a page the
 * shop forgot to delete.
 *
 * `import.meta.env.DEV` is a compile-time constant, so the production build
 * evaluates this to null, drops the route below, and never emits the chunk at
 * all — the page is absent from the deployed bundle rather than merely hidden
 * behind a check someone could navigate past.
 */
const StyleGuidePage = import.meta.env.DEV ? lazy(() => import('@/pages/StyleGuidePage.jsx')) : null;

const LoginPage = lazy(() => import('@/pages/auth/LoginPage.jsx'));
const StaffLoginPage = lazy(() => import('@/pages/auth/StaffLoginPage.jsx'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage.jsx'));
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage.jsx'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage.jsx'));

// --- Storefront ---
const CustomerLayout = lazy(() => import('@/layouts/CustomerLayout.jsx'));
const HomePage = lazy(() => import('@/pages/customer/HomePage.jsx'));
const MenuPage = lazy(() => import('@/pages/customer/MenuPage.jsx'));
const SearchPage = lazy(() => import('@/pages/customer/SearchPage.jsx'));
const ProductDetailPage = lazy(() => import('@/pages/customer/ProductDetailPage.jsx'));
const WishlistPage = lazy(() => import('@/pages/customer/WishlistPage.jsx'));
const AccountLayout = lazy(() => import('@/layouts/AccountLayout.jsx'));
const AccountOverviewPage = lazy(() => import('@/pages/account/AccountOverviewPage.jsx'));
const AccountOrdersPage = lazy(() => import('@/pages/account/AccountOrdersPage.jsx'));
const AccountAddressesPage = lazy(() => import('@/pages/account/AccountAddressesPage.jsx'));
const AccountSecurityPage = lazy(() => import('@/pages/account/AccountSecurityPage.jsx'));
const OffersPage = lazy(() => import('@/pages/customer/OffersPage.jsx'));
const AboutPage = lazy(() => import('@/pages/customer/AboutPage.jsx'));
const ContactPage = lazy(() => import('@/pages/customer/ContactPage.jsx'));
const CustomerFeedbackPage = lazy(() => import('@/pages/customer/FeedbackPage.jsx'));
const TrackOrderPage = lazy(() => import('@/pages/customer/TrackOrderPage.jsx'));
const CartPage = lazy(() => import('@/pages/customer/CartPage.jsx'));
const CheckoutPage = lazy(() => import('@/pages/customer/CheckoutPage.jsx'));
const OrderConfirmationPage = lazy(() => import('@/pages/customer/OrderConfirmationPage.jsx'));
const PosLoginPage = lazy(() => import('@/pages/pos/PosLoginPage.jsx'));
const PosTerminalPage = lazy(() => import('@/pages/pos/PosTerminalPage.jsx'));
const AdminLayout = lazy(() => import('@/layouts/AdminLayout.jsx'));
const CategoriesPage = lazy(() => import('@/pages/admin/CategoriesPage.jsx'));
const ProductsPage = lazy(() => import('@/pages/admin/ProductsPage.jsx'));
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage.jsx'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage.jsx'));
const InventoryPage = lazy(() => import('@/pages/admin/InventoryPage.jsx'));
const StaffPage = lazy(() => import('@/pages/admin/StaffPage.jsx'));
const RolesPage = lazy(() => import('@/pages/admin/RolesPage.jsx'));
const WebsiteManagementPage = lazy(() => import('@/pages/admin/WebsiteManagementPage.jsx'));
const FinancePage = lazy(() => import('@/pages/admin/FinancePage.jsx'));
const SystemLogsPage = lazy(() => import('@/pages/admin/SystemLogsPage.jsx'));
const NotificationsPage = lazy(() => import('@/pages/admin/NotificationsPage.jsx'));
const ReportsPage = lazy(() => import('@/pages/admin/ReportsPage.jsx'));
const FeedbackPage = lazy(() => import('@/pages/admin/FeedbackPage.jsx'));
const OrdersPage = lazy(() => import('@/pages/admin/OrdersPage.jsx'));
const StationsPage = lazy(() => import('@/pages/admin/StationsPage.jsx'));
const AdminOffersPage = lazy(() => import('@/pages/admin/OffersPage.jsx'));
const CustomersPage = lazy(() => import('@/pages/admin/CustomersPage.jsx'));
const PosManagementPage = lazy(() => import('@/pages/admin/PosManagementPage.jsx'));
const StoresPage = lazy(() => import('@/pages/admin/StoresPage.jsx'));
const TillReportPage = lazy(() => import('@/pages/admin/TillReportPage.jsx'));
const PagesPage = lazy(() => import('@/pages/admin/PagesPage.jsx'));
const MessagesPage = lazy(() => import('@/pages/admin/MessagesPage.jsx'));
const AdminProfilePage = lazy(() => import('@/pages/admin/AdminProfilePage.jsx'));
const PageView = lazy(() => import('@/pages/customer/PageView.jsx'));
// --- Kitchen surfaces (full-screen, no admin chrome) ---
const KitchenDisplayPage = lazy(() => import('@/pages/kitchen/KitchenDisplayPage.jsx'));
const OrderBoardPage = lazy(() => import('@/pages/kitchen/OrderBoardPage.jsx'));

const s = (element) => <Suspense fallback={<PageLoader />}>{element}</Suspense>;

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ================= POS terminal (own session) ================= */}
        <Route
          path="/pos/*"
          element={
            <PosAuthProvider>
              <Routes>
                <Route path="login" element={s(<PosLoginPage />)} />
                <Route index element={<PosProtectedRoute>{s(<PosTerminalPage />)}</PosProtectedRoute>} />
                {/* Unknown /pos/* returns to the register, never to the
                    storefront 404 — a cashier should not be thrown out of the
                    till surface by a mistyped URL. */}
                <Route path="*" element={<Navigate to={ROUTES.POS} replace />} />
              </Routes>
            </PosAuthProvider>
          }
        />

        {/* ================= Website + back office ================= */}
        <Route
          path="/*"
          element={
            /* SiteProvider wraps the website and the back office: both show the
               business name, and fetching the same settings twice per page load
               is what this replaced. The POS subtree has its own config call. */
            <SiteProvider>
              <AuthProvider>
                <Routes>
                  <Route path="login" element={s(<LoginPage />)} />
                  <Route path="forgot-password" element={s(<ForgotPasswordPage />)} />
                  <Route path="reset-password" element={s(<ResetPasswordPage />)} />
                  <Route path="verify-email" element={s(<VerifyEmailPage />)} />
                  <Route path="register" element={s(<RegisterPage />)} />
                  <Route path="unauthorized" element={<UnauthorizedPage />} />

                  {/*
                  The staff portal sits at /admin/login and must be declared
                  before the guarded `admin/*` branch below. Registered after
                  it, StaffRoute would intercept the login page itself and
                  redirect to… the login page, forever.
                */}
                  <Route path="admin/login" element={s(<StaffLoginPage />)} />

                  {/* --- Kitchen Display + Order Status Board ---
                      Full-screen surfaces for the pass and the counter TV.
                      No login wall here: with "Open the kitchen screens without
                      signing in" on (Settings → Kitchen Display, the default)
                      they show the orders straight away. With it off, the
                      server refuses and the page sends you to sign in. */}
                  <Route path="kitchen" element={s(<KitchenDisplayPage />)} />
                  <Route path="display" element={s(<OrderBoardPage />)} />

                  {/* --- Back office (staff only) --- */}
                  <Route
                    path="admin/*"
                    element={
                      <StaffRoute>
                        <Suspense fallback={<PageLoader />}>
                          <AdminLayout />
                        </Suspense>
                      </StaffRoute>
                    }
                  >
                    <Route index element={s(<DashboardPage />)} />
                    <Route path="categories" element={s(<CategoriesPage />)} />
                    <Route path="products" element={s(<ProductsPage />)} />
                    <Route path="settings" element={s(<SettingsPage />)} />
                    <Route path="website" element={s(<WebsiteManagementPage />)} />
                    <Route path="finance" element={s(<FinancePage />)} />
                    <Route path="logs" element={s(<SystemLogsPage />)} />
                    <Route path="notifications" element={s(<NotificationsPage />)} />
                    <Route path="inventory" element={s(<InventoryPage />)} />
                    <Route path="users" element={s(<StaffPage />)} />
                    <Route path="roles" element={s(<RolesPage />)} />
                    <Route path="reports" element={s(<ReportsPage />)} />
                    <Route path="feedback" element={s(<FeedbackPage />)} />
                    <Route path="orders" element={s(<OrdersPage />)} />
                    <Route path="stations" element={s(<StationsPage />)} />
                    <Route path="offers" element={s(<AdminOffersPage />)} />
                    <Route path="customers" element={s(<CustomersPage />)} />
                    <Route path="stores" element={s(<StoresPage />)} />
                    <Route path="pos" element={s(<PosManagementPage />)} />
                    <Route path="pos/:code" element={s(<TillReportPage />)} />
                    <Route path="pages" element={s(<PagesPage />)} />
                    <Route path="messages" element={s(<MessagesPage />)} />
                    <Route path="profile" element={s(<AdminProfilePage />)} />
                    <Route path="*" element={<Navigate to="/admin/categories" replace />} />
                  </Route>

                  {/* --- Public storefront --- */}
                  <Route
                    element={
                      /* CartProvider wraps only the storefront — the POS has its
                       own cart, and the back office has none. */
                      <CartProvider>
                        {/* Inside CartProvider so "move to cart" from the
                          wishlist can reach both. */}
                        <WishlistProvider>
                          <Suspense fallback={<PageLoader />}>
                            <CustomerLayout />
                          </Suspense>
                        </WishlistProvider>
                      </CartProvider>
                    }
                  >
                    <Route index element={s(<HomePage />)} />
                    <Route path="menu" element={s(<MenuPage />)} />
                    <Route path="search" element={s(<SearchPage />)} />
                    {/* Category pages reuse MenuPage — same layout, filtered by
                      the :slug param, so there is one implementation to maintain. */}
                    <Route path="menu/:slug" element={s(<MenuPage />)} />
                    <Route path="product/:slug" element={s(<ProductDetailPage />)} />
                    <Route path="offers" element={s(<OffersPage />)} />
                    <Route path="about" element={s(<AboutPage />)} />
                    <Route path="contact" element={s(<ContactPage />)} />
                    {/* Anyone can leave feedback — no account needed. */}
                    <Route path="feedback" element={s(<CustomerFeedbackPage />)} />
                    {/* Pages the owner writes in Website → Pages (Privacy, Catering, FAQ…). */}
                    <Route path="p/:slug" element={s(<PageView />)} />
                    <Route path="track-order" element={s(<TrackOrderPage />)} />

                    {/* --- Shopping. Guest-capable: no sign-in required to buy. --- */}
                    <Route path="wishlist" element={s(<WishlistPage />)} />

                    {/* --- Account. Signed-in customers only. --- */}
                    <Route
                      path="account"
                      element={
                        <CustomerRoute>
                          <Suspense fallback={<PageLoader />}>
                            <AccountLayout />
                          </Suspense>
                        </CustomerRoute>
                      }
                    >
                      <Route index element={s(<AccountOverviewPage />)} />
                      <Route path="orders" element={s(<AccountOrdersPage />)} />
                      <Route path="addresses" element={s(<AccountAddressesPage />)} />
                      <Route path="security" element={s(<AccountSecurityPage />)} />
                      {/* The nav links here from the profile menu, and it is the
                        page people expect "profile" to mean. */}
                      <Route path="profile" element={<Navigate to={ROUTES.ACCOUNT_SECURITY} replace />} />
                    </Route>

                    <Route path="cart" element={s(<CartPage />)} />
                    <Route path="checkout" element={s(<CheckoutPage />)} />
                    <Route path="order/:orderNumber" element={s(<OrderConfirmationPage />)} />
                    {/* Internal design reference. Absent from production builds. */}
                    {StyleGuidePage && <Route path="style-guide" element={s(<StyleGuidePage />)} />}
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AuthProvider>
            </SiteProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Shown when a signed-in account lacks the role for a surface.
 * Distinct from the login page: bouncing an authenticated user back to a form
 * they already completed is confusing — the problem is authorisation, not
 * identity, and the message says so.
 */
function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-2xl font-bold">Access denied</h1>
      <p className="max-w-md text-muted-foreground">
        Your account doesn&apos;t have permission to open this area. If you think that&apos;s wrong, ask a
        manager to review your role.
      </p>
      <Button onClick={() => window.history.back()}>Go back</Button>
      <Link to={ROUTES.HOME} className="text-sm text-gold hover:underline">
        Return to the website
      </Link>
    </div>
  );
}

export default AppRouter;
