Feature: E-commerce checkout on a real public website
  Kraken is also a first-class single-user E2E tool. This suite drives
  saucedemo.com (Sauce Labs' public demo store) through a full purchase,
  page-object style: the steps speak business language; every selector
  lives in a Page Object.

  Scenario: a standard user buys a backpack
    Given carol is logged into the store as "standard_user"
    When carol adds "Sauce Labs Backpack" to the cart
    Then carol sees 1 item in the cart badge
    When carol completes checkout as a seeded customer
    Then carol receives an order confirmation with thanks
