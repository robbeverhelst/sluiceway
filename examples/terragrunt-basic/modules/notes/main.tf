terraform {
  required_providers {
    random = { source = "hashicorp/random", version = "3.7.2" }
  }
}

variable "env" {
  type = string
}

variable "motd" {
  type    = string
  default = "hello"
}

# Marked sensitive, and still never shown by Sluiceway, marked or not.
variable "secret" {
  type      = string
  sensitive = true
  default   = "CANARY-SECRET"
}

resource "random_pet" "name" {
  prefix = var.env
}

# Changes in place: a new input is an update.
resource "terraform_data" "config" {
  input = {
    greeting = var.motd
    canary   = "CANARY-VALUE"
    secret   = var.secret
  }
}

output "pet" {
  value = random_pet.name.id
}
